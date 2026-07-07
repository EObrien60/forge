import { Plan } from "../project/plan"
import { ProjectContext } from "../project/context"
import { addLwdManifests } from "../generators/lwd"
import { ciYaml, envBase } from "../generators/root"
import { log } from "../utils/logger"
import { flagsFrom, runPlan } from "./shared"

const ARTIFACTS = ["lwd", "ci", "env"] as const

/** `forge generate <artifact>` — (re)generate a specific artifact. */
export async function generateCommand(artifact: string, opts: Record<string, unknown>): Promise<void> {
  const ctx = await ProjectContext.load(process.cwd())
  if (!ctx.hasManifest()) {
    log.error("No forge.json found. Run inside a Forge project.")
    process.exitCode = 1
    return
  }
  const manifest = ctx.requireManifest()
  const flags = flagsFrom(opts)
  const plan = new Plan()

  switch (artifact) {
    case "lwd":
      addLwdManifests(plan, manifest)
      log.info("Regenerating lwd manifests (use --force to overwrite existing ones).")
      break
    case "ci":
      plan.overwrite(".github/workflows/ci.yml", ciYaml(manifest.name), "CI workflow")
      break
    case "env":
      // Only ensures the base file exists; capabilities own their own env keys.
      plan.create(".env.example", envBase(manifest.name), "environment example (base)")
      break
    default:
      log.error(`Unknown artifact "${artifact}". Available: ${ARTIFACTS.join(", ")}`)
      process.exitCode = 1
      return
  }

  await runPlan(ctx.root, plan, flags)
}
