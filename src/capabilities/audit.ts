import type { Capability } from "./types"
import { addPlatformPackage, hasNotesExample, migrationModule } from "./helpers"

export const audit: Capability = {
  name: "audit",
  requires: ["events"],
  describe: "Immutable who-did-what-to-what trail, derived from events",
  apply(ctx, plan) {
    addPlatformPackage(plan, ctx, "audit", { worker: true })
    plan.create("scripts/migrations.d/audit.ts", migrationModule("audit"), "audit migrations wiring")

    const rules = rulesFile(hasNotesExample(ctx))
    if (ctx.hasWorker()) {
      // Rules live in the worker so the consumer imports them without crossing
      // app boundaries (which would break the worker's tsc rootDir).
      plan.create("apps/worker/src/audit-rules.ts", rules, "audit rule definitions")
      plan.create("apps/worker/src/consumers.d/audit.ts", WORKER, "audit event consumer tick")
    } else {
      plan.create("apps/api/src/platform/audit-rules.ts", rules, "audit rules (add a worker to consume them)")
    }

    plan.patchManifest({ platform: { audit: true } })
    plan.nextStep("Run `pnpm migrate`. Edit audit rules in apps/worker/src/audit-rules.ts.")
  },
}

function rulesFile(notes: boolean): string {
  const rules = notes
    ? `  defineAuditRule({
    event: "note.created",
    action: "note.created",
    target: (p: { id: string }) => ({ type: "note", id: p.id }),
  }),
  defineAuditRule({
    event: "note.updated",
    action: "note.updated",
    target: (p: { id: string }) => ({ type: "note", id: p.id }),
  }),
  defineAuditRule({
    event: "note.deleted",
    action: "note.deleted",
    target: (p: { id: string }) => ({ type: "note", id: p.id }),
  }),`
    : `  // defineAuditRule({ event: "thing.created", action: "thing.created",
  //   target: (p) => ({ type: "thing", id: p.id }) }),`
  return `// Adjust to the @obh/audit version you install.
import { createRuleSet, defineAuditRule } from "@obh/audit"

// Map domain events to immutable audit entries.
export const auditRules = createRuleSet([
${rules}
])
`
}

const WORKER = `// Consumes events and records audit entries. Reads platform.event_deliveries
// for the "audit" consumer (standalone Option B).
import { createAuditWorker, pgAdapter } from "@obh/audit"
import { auditRules } from "../audit-rules"
import type { WorkerContext } from "../context"

let worker: ReturnType<typeof createAuditWorker>

export function init(ctx: WorkerContext): void {
  worker = createAuditWorker({ db: pgAdapter(ctx.pool), rules: auditRules })
}

export async function tick(): Promise<void> {
  await worker.tick()
}
`
