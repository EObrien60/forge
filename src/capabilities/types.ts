import type { CapabilityName } from "../types"
import type { ProjectContext } from "../project/context"
import type { Plan } from "../project/plan"

/**
 * A capability installs one OBH platform primitive into a project. It only ever
 * builds up a Plan (which only ever creates files) — never patches shared code.
 */
export interface Capability {
  name: CapabilityName
  /** Other capabilities that must be present first. */
  requires?: CapabilityName[]
  /** One-line description for prompts and docs. */
  describe: string
  apply(ctx: ProjectContext, plan: Plan): void
}
