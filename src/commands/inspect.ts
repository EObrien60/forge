import path from "node:path"
import { ProjectContext } from "../project/context"
import { exists } from "../utils/fs"
import { log } from "../utils/logger"

/** `forge inspect` — report the project shape and detected conventions. */
export async function inspectCommand(): Promise<void> {
  const ctx = await ProjectContext.load(process.cwd())

  log.plain("")
  log.info(`Project root: ${ctx.root}`)

  if (!ctx.hasManifest()) {
    log.warn("No forge.json — this project was not created by Forge (or predates it).")
  } else {
    const m = ctx.requireManifest()
    log.plain(`  name:      ${m.name}`)
    log.plain(`  forge:     v${m.forgeVersion}`)
    log.plain(`  deploy:    ${m.deploy.target} (${m.deploy.topology} topology)`)
  }

  log.plain("")
  log.info("Apps:")
  if (ctx.appDirs.length === 0) log.dim("  (none)")
  for (const dir of ctx.appDirs) {
    const rec = ctx.manifest?.apps[dir]
    const meta = rec ? `${rec.role}${rec.framework ? " / " + rec.framework : ""}` : "unrecorded"
    log.plain(`  apps/${dir}  (${meta})`)
  }

  log.plain("")
  log.info("Packages:")
  if (ctx.packageDirs.length === 0) log.dim("  (none)")
  for (const dir of ctx.packageDirs) log.plain(`  packages/${dir}`)

  log.plain("")
  log.info("Platform primitives:")
  const installed = Object.entries(ctx.manifest?.platform ?? {}).filter(([, v]) => v)
  if (installed.length === 0) log.dim("  (none installed)")
  for (const [name] of installed) {
    const wired = await exists(path.join(ctx.root, `scripts/migrations.d/${name}.ts`))
    log.plain(`  ${name}${wired ? "" : "  (migration wiring MISSING)"}`)
  }

  log.plain("")
  log.info("Deployment manifests:")
  const deployFiles = ["api", "admin", "worker", "db"]
  let anyDeploy = false
  for (const f of deployFiles) {
    if (await exists(path.join(ctx.root, `deploy/${f}.lwd.toml`))) {
      log.plain(`  deploy/${f}.lwd.toml`)
      anyDeploy = true
    }
  }
  if (!anyDeploy) log.dim("  (none — run `forge generate lwd`)")

  log.plain("")
  log.info("Run `forge doctor` to check conventions.")
}
