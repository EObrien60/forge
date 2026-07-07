import { capture, type CaptureOptions, type CaptureResult } from "../utils/shell"
import type { AppStatus } from "./types"

export type Runner = (cmd: string, args: string[], opts?: CaptureOptions) => Promise<CaptureResult>

export interface LwdAdapter {
  secretLs(app: string): Promise<string[]>
  secretSet(app: string, key: string, value: string): Promise<void>
  apply(manifestPath: string): Promise<void>
  status(app: string): Promise<AppStatus>
  rm(app: string): Promise<void>
}

export interface LwdAdapterOptions {
  /** lwd binary name/path (default "lwd"). */
  bin?: string
  cwd?: string
  /** Injectable runner for tests; defaults to the real capturing shell. */
  run?: Runner
}

const SECRET_NAME_LINE = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Thin wrapper over the `lwd` CLI. Inherits ambient LWD_DAEMON/LWD_API_TOKEN
 * (so it targets local or remote daemons unchanged). Secret values go in on
 * stdin, never argv. No lwd changes — a pure client of its stable CLI.
 */
export function createLwdAdapter(opts: LwdAdapterOptions = {}): LwdAdapter {
  const bin = opts.bin ?? "lwd"
  const run: Runner = opts.run ?? ((cmd, args, o) => capture(cmd, args, { cwd: opts.cwd, ...o }))

  async function invoke(args: string[], o?: CaptureOptions): Promise<CaptureResult> {
    try {
      return await run(bin, args, o)
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === "ENOENT") {
        throw new Error(`\`${bin}\` not found on PATH. Install lwd or set the binary path.`)
      }
      throw err
    }
  }

  const ensureOk = (r: CaptureResult, what: string): void => {
    if (r.code !== 0) throw new Error(`${what} failed: ${(r.stderr || r.stdout).trim() || `exit ${r.code}`}`)
  }

  return {
    async secretLs(app) {
      const r = await invoke(["secret", "ls", app])
      // A not-yet-deployed app has no secrets — treat any error as empty.
      if (r.code !== 0) return []
      return r.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => SECRET_NAME_LINE.test(l))
    },
    async secretSet(app, key, value) {
      const r = await invoke(["secret", "set", app, key], { stdin: value })
      ensureOk(r, `lwd secret set ${app} ${key}`)
    },
    async apply(manifestPath) {
      const r = await invoke(["apply", manifestPath])
      ensureOk(r, `lwd apply ${manifestPath}`)
    },
    async status(app) {
      const r = await invoke(["status", app])
      const text = (r.stdout + " " + r.stderr).toLowerCase()
      const healthy = /\b(running|healthy)\b/.test(text) && !/\b(stopped|failed|error|unhealthy|crash)\b/.test(text)
      const state = (text.match(/\b(running|healthy|stopped|failed|pending|starting|unhealthy)\b/) ?? ["unknown"])[0]
      return { app, healthy, state }
    },
    async rm(app) {
      const r = await invoke(["rm", app])
      ensureOk(r, `lwd rm ${app}`)
    },
  }
}
