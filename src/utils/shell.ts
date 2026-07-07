import { spawn } from "node:child_process"

/**
 * Run a command, streaming stdio to the terminal. Used sparingly — Forge is a
 * file generator, not a task runner. Returns the exit code.
 */
export function run(cmd: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" })
    child.on("error", reject)
    child.on("close", (code) => resolve(code ?? 0))
  })
}

export interface CaptureResult {
  code: number
  stdout: string
  stderr: string
}

export interface CaptureOptions {
  cwd?: string
  /** Written to the child's stdin then closed (e.g. a secret value). */
  stdin?: string
}

/**
 * Run a command with piped stdio and capture its output. Used by the lwd CLI
 * adapter (secret values go in via `stdin`, never argv). `run()` is untouched.
 */
export function capture(cmd: string, args: string[], opts: CaptureOptions = {}): Promise<CaptureResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (d) => (stdout += d.toString()))
    child.stderr.on("data", (d) => (stderr += d.toString()))
    child.on("error", reject)
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }))
    if (opts.stdin !== undefined) {
      child.stdin.write(opts.stdin)
    }
    child.stdin.end()
  })
}
