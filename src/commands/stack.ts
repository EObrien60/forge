import type { StackManifest } from "../stack/types"
import { inferStack } from "../stack/infer"
import { loadStackManifest, saveStackManifest, validateStackManifest } from "../stack/manifest"
import { createLwdAdapter } from "../stack/lwd"
import { computeStackDeploy, executeStackDeploy, printStackPlan } from "../stack/wire"
import { readLwdToml } from "../stack/lwdtoml"
import { findProjectRoot } from "../project/paths"
import { log } from "../utils/logger"
import { confirm } from "../prompts"
import path from "node:path"

interface StackOptions {
  dryRun?: boolean
  yes?: boolean
  force?: boolean
  rotate?: string
  app?: string
  noWait?: boolean
  destroyData?: boolean
}

/** `forge stack <init|deploy|status|rm>` (+ `forge deploy` alias → deploy). */
export async function stackCommand(action: string, opts: StackOptions): Promise<void> {
  const root = await findProjectRoot(process.cwd())
  switch (action) {
    case "init":
      return stackInit(root, opts)
    case "deploy":
      return stackDeploy(root, opts)
    case "status":
      return stackStatus(root)
    case "rm":
      return stackRm(root, opts)
    default:
      log.error(`Unknown action "${action}". Use: init | deploy | status | rm`)
      process.exitCode = 1
  }
}

async function stackInit(root: string, opts: StackOptions): Promise<void> {
  const inferred = await inferStack(root)
  const existing = await loadStackManifest(root)
  const merged = existing && !opts.force ? mergeStack(existing, inferred) : inferred

  const errors = validateStackManifest(merged)
  if (errors.length > 0) {
    log.error("Proposed stack manifest is invalid:")
    for (const e of errors) log.plain("    - " + e)
    process.exitCode = 1
    return
  }

  if (opts.dryRun) {
    log.info(`Proposed deploy/stack.json for "${merged.name}":`)
    log.plain(JSON.stringify(merged, null, 2))
    log.info("Dry run — not written.")
    return
  }

  await saveStackManifest(root, merged)
  const genKeys = Object.keys(merged.secrets.generate)
  const connKeys = Object.keys(merged.secrets.connections)
  log.success(`Wrote deploy/stack.json — ${merged.apps.length} apps, ${genKeys.length} generated, ${connKeys.length} connections${merged.secrets.manual.length ? `, ${merged.secrets.manual.length} manual` : ""}.`)
  if (merged.secrets.manual.length) log.warn(`Manual secrets you must set: ${merged.secrets.manual.join(", ")}`)
  log.info("Review deploy/stack.json, then run `forge stack deploy`.")
}

async function stackDeploy(root: string, opts: StackOptions): Promise<void> {
  const manifest = await loadStackManifest(root)
  if (!manifest) {
    log.error("No deploy/stack.json. Run `forge stack init` first.")
    process.exitCode = 1
    return
  }
  const errors = validateStackManifest(manifest)
  if (errors.length > 0) {
    log.error("deploy/stack.json is invalid:")
    for (const e of errors) log.plain("    - " + e)
    process.exitCode = 1
    return
  }

  const adapter = createLwdAdapter()
  const rotate = opts.rotate ? opts.rotate.split(",").map((s) => s.trim()).filter(Boolean) : undefined
  const { plan } = await computeStackDeploy(root, manifest, adapter, { rotate, onlyApp: opts.app })

  printStackPlan(manifest, plan)

  if (opts.dryRun) {
    log.plain("")
    log.info("Dry run — no secrets set, nothing applied.")
    return
  }

  const blocked = plan.items.filter((i) => i.action === "blocked")
  const manualMissing = plan.items.filter((i) => i.action === "manual-missing")
  if (blocked.length > 0 || manualMissing.length > 0) {
    log.plain("")
    log.error("Cannot deploy: fix the problems above (nothing was applied).")
    process.exitCode = 1
    return
  }

  if (!opts.yes) {
    log.plain("")
    const ok = await confirm(`Set secrets and deploy ${plan.order.length} app(s) to lwd?`)
    if (!ok) {
      log.info("Aborted.")
      return
    }
  }

  await executeStackDeploy(root, manifest, adapter, plan, { noWait: opts.noWait })
  log.success(`Stack "${manifest.name}" deployed.`)
}

async function stackStatus(root: string): Promise<void> {
  const manifest = await loadStackManifest(root)
  if (!manifest) {
    log.error("No deploy/stack.json. Run `forge stack init` first.")
    process.exitCode = 1
    return
  }
  const adapter = createLwdAdapter()
  log.info(`Stack "${manifest.name}":`)
  for (const appName of manifest.order) {
    try {
      const s = await adapter.status(appName)
      if (s.healthy) log.success(`${appName}: ${s.state}`)
      else log.warn(`${appName}: ${s.state}`)
    } catch (err) {
      log.error(`${appName}: ${(err as Error).message}`)
    }
  }
}

async function stackRm(root: string, opts: StackOptions): Promise<void> {
  const manifest = await loadStackManifest(root)
  if (!manifest) {
    log.error("No deploy/stack.json. Run `forge stack init` first.")
    process.exitCode = 1
    return
  }
  if (!opts.yes) {
    const ok = await confirm(`Tear down stack "${manifest.name}" (${manifest.apps.length} apps)?`)
    if (!ok) {
      log.info("Aborted.")
      return
    }
  }
  const adapter = createLwdAdapter()
  // Reverse of apply order.
  for (const appName of [...manifest.order].reverse()) {
    try {
      await adapter.rm(appName)
      log.success(`removed ${appName}`)
    } catch (err) {
      log.warn(`${appName}: ${(err as Error).message}`)
    }
  }

  // Named data volumes: lwd's CLI has no volume-destroy, so they are preserved.
  const volumes = await namedVolumes(root, manifest)
  if (volumes.length > 0) {
    if (opts.destroyData) {
      log.warn("`--destroy-data`: lwd's CLI does not expose volume removal, so named data volumes are PRESERVED.")
      log.warn("Remove them manually on the host if intended: " + volumes.map((v) => `docker volume rm ${v}`).join("; "))
    } else {
      log.info("Named data volumes preserved: " + volumes.join(", "))
    }
  }
}

async function namedVolumes(root: string, manifest: StackManifest): Promise<string[]> {
  const out = new Set<string>()
  for (const app of manifest.apps) {
    const toml = await readLwdToml(path.join(root, app.manifest))
    for (const svc of toml?.services ?? []) {
      if (svc.volume) {
        const name = svc.volume.split(":")[0]
        if (name && !name.startsWith("/") && !name.startsWith(".")) out.add(name)
      }
    }
  }
  return [...out]
}

/** Non-destructive merge: keep existing entries (hand edits), add newly-inferred ones. */
function mergeStack(existing: StackManifest, inferred: StackManifest): StackManifest {
  const appNames = new Set(existing.apps.map((a) => a.name))
  const apps = [...existing.apps, ...inferred.apps.filter((a) => !appNames.has(a.name))]
  const order = [...existing.order, ...inferred.order.filter((n) => !existing.order.includes(n))]
  return {
    name: existing.name,
    stackVersion: existing.stackVersion,
    apps,
    order,
    secrets: {
      generate: { ...inferred.secrets.generate, ...existing.secrets.generate },
      connections: { ...inferred.secrets.connections, ...existing.secrets.connections },
      manual: [...new Set([...existing.secrets.manual, ...inferred.secrets.manual])],
    },
  }
}
