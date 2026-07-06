import { Plan } from "../project/plan"
import { ProjectContext } from "../project/context"
import { addLwdManifests } from "../generators/lwd"
import { log } from "../utils/logger"
import { flagsFrom, runPlan } from "./shared"

/** `forge generate <artifact>` — (re)generate a specific artifact. */
export async function generateCommand(artifact: string, opts: Record<string, unknown>): Promise<void> {
  const ctx = await ProjectContext.load(process.cwd())
  if (!ctx.hasManifest()) {
    log.error("No forge.json found. Run inside a Forge project.")
    process.exitCode = 1
    return
  }
  const flags = flagsFrom(opts)
  const plan = new Plan()

  switch (artifact) {
    case "lwd":
      addLwdManifests(plan, ctx.requireManifest())
      log.info("Regenerating lwd manifests (use --force to overwrite existing ones).")
      break
    default:
      log.error(`Unknown artifact "${artifact}". Available in v1: lwd`)
      process.exitCode = 1
      return
  }

  await runPlan(ctx.root, plan, flags)
}
