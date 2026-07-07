import path from "node:path"
import { Plan } from "../project/plan"
import { ProjectContext } from "../project/context"
import { exists, listDirs, readFileSafe } from "../utils/fs"
import { log } from "../utils/logger"
import { flagsFrom, runPlan } from "./shared"

/** Directory of shipped skills, resolved relative to this file (works in src and dist). */
function skillsRoot(): string {
  return path.join(__dirname, "..", "..", "skills")
}

async function describe(name: string): Promise<string> {
  const raw = await readFileSafe(path.join(skillsRoot(), name, "SKILL.md"))
  const match = raw?.match(/^description:\s*(.+)$/m)
  return match?.[1]?.trim() ?? ""
}

/** `forge skill <list|install> [name]` — manage the OBH Claude skills. */
export async function skillCommand(action: string, name: string | undefined, opts: Record<string, unknown>): Promise<void> {
  const root = skillsRoot()
  if (!(await exists(root))) {
    log.error("No bundled skills found in this Forge install.")
    process.exitCode = 1
    return
  }

  if (action === "list") {
    const names = await listDirs(root)
    log.info("Available OBH skills:")
    for (const n of names.sort()) log.plain(`  ${n} — ${await describe(n)}`)
    log.plain("")
    log.dim("Install into a project with: forge skill install <name>")
    return
  }

  if (action === "install") {
    if (!name) {
      log.error("Usage: forge skill install <name>")
      process.exitCode = 1
      return
    }
    const content = await readFileSafe(path.join(root, name, "SKILL.md"))
    if (content === undefined) {
      log.error(`Unknown skill "${name}". Run \`forge skill list\`.`)
      process.exitCode = 1
      return
    }
    const ctx = await ProjectContext.load(process.cwd())
    const plan = new Plan().create(`.claude/skills/${name}/SKILL.md`, content, `install skill ${name}`)
    await runPlan(ctx.root, plan, flagsFrom(opts))
    return
  }

  log.error(`Unknown action "${action}". Use: forge skill list | forge skill install <name>`)
  process.exitCode = 1
}
