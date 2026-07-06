import path from "node:path"
import type {
  ApplyResult,
  DepAdd,
  EnvVar,
  FileOp,
  ForgeManifest,
  ScriptAdd,
} from "../types"
import { exists, readFileSafe, readJson, writeFile, writeJson } from "../utils/fs"
import { log } from "../utils/logger"
import { loadManifest, mergeManifest, saveManifest, type DeepPartial } from "./manifest"

export interface ApplyOptions {
  dryRun: boolean
  /** Allow overwriting existing files whose contents differ. */
  force: boolean
}

interface AppliedOp {
  op: FileOp
  result: ApplyResult
}

/**
 * A Plan accumulates every change a command wants to make, then applies them in
 * one pass. This is what gives every Forge command uniform dry-run, idempotency,
 * and safety (see spec §21). Commands never touch the filesystem directly.
 */
export class Plan {
  private fileOps: FileOp[] = []
  private deps: DepAdd[] = []
  private envVars: EnvVar[] = []
  private scripts: ScriptAdd[] = []
  private manifestPatch: DeepPartial<ForgeManifest> = {}
  private nextSteps: string[] = []

  /** Create a file only if it does not already exist. */
  create(p: string, content: string, describe: string): this {
    this.fileOps.push({ kind: "create", path: p, content, describe })
    return this
  }

  /** Replace a file's contents (needs --force / confirmation if it differs). */
  overwrite(p: string, content: string, describe: string): this {
    this.fileOps.push({ kind: "overwrite", path: p, content, describe })
    return this
  }

  /** Insert a clearly-marked, idempotent section into a file (creating it if absent). */
  append(p: string, marker: string, section: string, describe: string): this {
    this.fileOps.push({ kind: "append", path: p, marker, section, describe })
    return this
  }

  addDependency(target: string, name: string, version: string, dev = false): this {
    this.deps.push({ target, name, version, dev })
    return this
  }

  addEnvVar(v: EnvVar): this {
    this.envVars.push(v)
    return this
  }

  addScript(name: string, command: string): this {
    this.scripts.push({ name, command })
    return this
  }

  patchManifest(patch: DeepPartial<ForgeManifest>): this {
    this.manifestPatch = deepMerge(this.manifestPatch, patch)
    return this
  }

  nextStep(msg: string): this {
    this.nextSteps.push(msg)
    return this
  }

  isEmpty(): boolean {
    return (
      this.fileOps.length === 0 &&
      this.deps.length === 0 &&
      this.envVars.length === 0 &&
      this.scripts.length === 0 &&
      Object.keys(this.manifestPatch).length === 0
    )
  }

  /** Human-readable preview of everything this plan would do. */
  async render(root: string): Promise<string> {
    const lines: string[] = []
    for (const op of this.fileOps) {
      const status = await this.classify(root, op)
      lines.push(`  ${labelFor(status)}  ${op.path}  — ${op.describe}`)
    }
    for (const d of this.deps) {
      lines.push(`  dep      ${d.name}@${d.version}${d.dev ? " (dev)" : ""} → ${d.target}/package.json`)
    }
    for (const v of this.envVars) {
      lines.push(`  env      ${v.name}${v.secret ? " (secret)" : ""} → .env.example`)
    }
    for (const s of this.scripts) {
      lines.push(`  script   ${s.name} → package.json`)
    }
    if (Object.keys(this.manifestPatch).length > 0) {
      lines.push(`  manifest updates → forge.json`)
    }
    return lines.join("\n")
  }

  /** Apply the plan. Returns whether anything was written. */
  async apply(root: string, opts: ApplyOptions): Promise<boolean> {
    const applied: AppliedOp[] = []

    // 1. Detect conflicts up front so a dry-run/real run reports them cleanly.
    for (const op of this.fileOps) {
      const result = await this.classify(root, op)
      if (result === "conflict" && !opts.force) {
        log.error(`refusing to overwrite ${op.path} (differs from generated output). Re-run with --force to replace it.`)
        return false
      }
      applied.push({ op, result })
    }

    if (opts.dryRun) return false

    // 2. Files first (they create the package.json files that deps/scripts patch).
    for (const { op, result } of applied) {
      if (result === "skipped") continue
      const target = path.join(root, op.path)
      if (op.kind === "append") {
        await this.applyAppend(target, op)
      } else {
        await writeFile(target, op.content ?? "")
      }
    }

    // 3. Dependencies, grouped by target package.json.
    await this.applyDeps(root)

    // 4. Root scripts.
    await this.applyScripts(root)

    // 5. Env example.
    await this.applyEnv(root)

    // 6. forge.json manifest.
    if (Object.keys(this.manifestPatch).length > 0) {
      const existing = await loadManifest(root)
      if (existing) {
        await saveManifest(root, mergeManifest(existing, this.manifestPatch))
      }
    }

    // 7. Report.
    for (const { op, result } of applied) {
      if (result === "created") log.success(`created ${op.path}`)
      else if (result === "appended") log.success(`updated ${op.path}`)
      else if (result === "overwritten" || result === "conflict") log.success(`overwrote ${op.path}`)
      else log.dim(`  skipped ${op.path} (already present)`)
    }
    if (this.nextSteps.length > 0) {
      log.plain("")
      log.info("Next steps:")
      for (const s of this.nextSteps) log.plain("    " + s)
    }
    return true
  }

  private async classify(root: string, op: FileOp): Promise<ApplyResult> {
    const target = path.join(root, op.path)
    const current = await readFileSafe(target)
    if (op.kind === "append") {
      if (current !== undefined && op.marker && current.includes(op.marker)) return "skipped"
      return current === undefined ? "created" : "appended"
    }
    if (current === undefined) return "created"
    if (current === op.content) return "skipped"
    return op.kind === "overwrite" ? "overwritten" : "conflict"
  }

  private async applyAppend(target: string, op: FileOp): Promise<void> {
    const current = (await readFileSafe(target)) ?? ""
    if (op.marker && current.includes(op.marker)) return
    const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : ""
    const block = `${prefix}${current.length > 0 ? "\n" : ""}${op.marker ?? ""}\n${op.section ?? ""}\n`
    await writeFile(target, current + block)
  }

  private async applyDeps(root: string): Promise<void> {
    const byTarget = new Map<string, DepAdd[]>()
    for (const d of this.deps) {
      const list = byTarget.get(d.target) ?? []
      list.push(d)
      byTarget.set(d.target, list)
    }
    for (const [targetDir, list] of byTarget) {
      const pkgPath = path.join(root, targetDir, "package.json")
      const pkg = (await readJson<Record<string, any>>(pkgPath)) ?? {}
      for (const d of list) {
        const key = d.dev ? "devDependencies" : "dependencies"
        pkg[key] = pkg[key] ?? {}
        if (!pkg[key][d.name]) pkg[key][d.name] = d.version
        pkg[key] = sortObject(pkg[key])
      }
      if (await exists(path.dirname(pkgPath))) await writeJson(pkgPath, pkg)
    }
  }

  private async applyScripts(root: string): Promise<void> {
    if (this.scripts.length === 0) return
    const pkgPath = path.join(root, "package.json")
    const pkg = (await readJson<Record<string, any>>(pkgPath)) ?? {}
    pkg.scripts = pkg.scripts ?? {}
    for (const s of this.scripts) {
      if (!pkg.scripts[s.name]) pkg.scripts[s.name] = s.command
    }
    await writeJson(pkgPath, pkg)
  }

  private async applyEnv(root: string): Promise<void> {
    if (this.envVars.length === 0) return
    const envPath = path.join(root, ".env.example")
    let current = (await readFileSafe(envPath)) ?? ""
    const additions: string[] = []
    for (const v of this.envVars) {
      const hasLine = new RegExp(`^${escapeRegExp(v.name)}=`, "m").test(current)
      if (hasLine) continue
      if (v.comment) additions.push(`# ${v.comment}`)
      additions.push(`${v.name}=${v.example}`)
    }
    if (additions.length === 0) return
    const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : ""
    await writeFile(envPath, current + prefix + additions.join("\n") + "\n")
  }
}

function labelFor(r: ApplyResult): string {
  switch (r) {
    case "created":
      return "create "
    case "appended":
      return "update "
    case "overwritten":
      return "replace"
    case "conflict":
      return "CONFLICT"
    default:
      return "skip   "
  }
}

function sortObject(obj: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)))
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function deepMerge<T>(a: T, b: T): T {
  if (b === undefined) return a
  if (typeof a !== "object" || a === null || Array.isArray(a)) return b
  const out: any = { ...a }
  for (const [k, v] of Object.entries(b as any)) {
    out[k] = k in (a as any) ? deepMerge((a as any)[k], v) : v
  }
  return out
}
