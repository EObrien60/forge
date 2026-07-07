import path from "node:path"
import type { CapabilityName } from "../types"
import { ProjectContext } from "../project/context"
import { exists } from "../utils/fs"
import { log } from "../utils/logger"

type Status = "pass" | "warn" | "fail"
interface Check {
  label: string
  status: Status
  hint?: string
}

const WORKER_PRIMITIVES: CapabilityName[] = [
  "events",
  "jobs",
  "audit",
  "webhooks",
  "import-export",
  "search",
  "analytics",
  "notifications",
]

/** `forge doctor` — check a project against OBH conventions. Reports only. */
export async function doctorCommand(): Promise<void> {
  const ctx = await ProjectContext.load(process.cwd())
  const checks: Check[] = []
  const has = (rel: string) => exists(path.join(ctx.root, rel))

  checks.push({
    label: "forge.json present and valid",
    status: ctx.hasManifest() ? "pass" : "warn",
    hint: ctx.hasManifest() ? undefined : "not a Forge project; some checks skipped",
  })

  if (ctx.hasApp("api")) {
    checks.push({
      label: "API health route",
      status: (await has("apps/api/src/routes/health.ts")) ? "pass" : "fail",
      hint: "expected apps/api/src/routes/health.ts",
    })
  }

  checks.push({ label: "CI workflow", status: (await has(".github/workflows/ci.yml")) ? "pass" : "warn", hint: ".github/workflows/ci.yml" })
  checks.push({ label: ".env.example", status: (await has(".env.example")) ? "pass" : "warn" })
  checks.push({ label: "migration runner", status: (await has("scripts/migrate.ts")) ? "pass" : "fail", hint: "scripts/migrate.ts" })

  // lwd manifests for each deployable app (mobile ships via EAS, not lwd).
  for (const dir of ctx.appDirs) {
    const role = ctx.manifest?.apps[dir]?.role
    if (role === "mobile") continue
    const file = role === "web" ? "admin" : dir
    checks.push({
      label: `lwd manifest for ${dir}`,
      status: (await has(`deploy/${file}.lwd.toml`)) ? "pass" : "warn",
      hint: `run \`forge generate lwd\``,
    })
  }

  // Each installed primitive must have migration wiring.
  const installed = Object.entries(ctx.manifest?.platform ?? {}).filter(([, v]) => v).map(([k]) => k as CapabilityName)
  for (const cap of installed) {
    checks.push({
      label: `${cap}: migration wiring`,
      status: (await has(`scripts/migrations.d/${cap}.ts`)) ? "pass" : "fail",
      hint: `primitive installed but scripts/migrations.d/${cap}.ts missing`,
    })
  }

  // Worker-bearing primitives need a worker app.
  const needsWorker = installed.some((c) => WORKER_PRIMITIVES.includes(c))
  if (needsWorker) {
    checks.push({
      label: "worker app for event/job/audit consumers",
      status: ctx.hasWorker() ? "pass" : "fail",
      hint: "run `forge add worker`",
    })
  }

  // Report.
  log.plain("")
  let fails = 0
  for (const c of checks) {
    if (c.status === "pass") log.success(c.label)
    else if (c.status === "warn") log.warn(c.label + (c.hint ? ` — ${c.hint}` : ""))
    else {
      fails++
      log.error(c.label + (c.hint ? ` — ${c.hint}` : ""))
    }
  }

  log.plain("")
  log.dim("Note: generated projects assume @obh/* platform packages are installable (published to your npm registry).")
  if (fails > 0) {
    log.error(`${fails} check(s) failed.`)
    process.exitCode = 1
  } else {
    log.success("All conventions satisfied.")
  }
}
