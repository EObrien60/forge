import type { Plan } from "../project/plan"
import { log } from "../utils/logger"
import { confirmApply } from "../prompts"

export interface GlobalFlags {
  dryRun: boolean
  yes: boolean
  force: boolean
}

export function flagsFrom(opts: { dryRun?: unknown; yes?: unknown; force?: unknown }): GlobalFlags {
  return {
    dryRun: Boolean(opts.dryRun),
    yes: Boolean(opts.yes),
    force: Boolean(opts.force),
  }
}

/** Render a plan, then (unless --dry-run) confirm and apply it. */
export async function runPlan(root: string, plan: Plan, flags: GlobalFlags): Promise<void> {
  if (plan.isEmpty()) {
    log.info("Nothing to do — everything is already in place.")
    return
  }

  log.info("Planned changes:")
  log.plain(await plan.render(root))
  log.plain("")

  if (flags.dryRun) {
    log.info("Dry run — no changes written.")
    return
  }

  if (!flags.yes) {
    const ok = await confirmApply()
    if (!ok) {
      log.info("Aborted.")
      return
    }
  }

  await plan.apply(root, { dryRun: false, force: flags.force })
}
