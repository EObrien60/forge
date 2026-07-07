import type { Capability } from "./types"
import { addPlatformPackage, hasNotesExample, migrationModule } from "./helpers"

export const audit: Capability = {
  name: "audit",
  requires: ["events"],
  describe: "Immutable who-did-what-to-what trail, derived from events",
  apply(ctx, plan) {
    addPlatformPackage(plan, ctx, "audit", { worker: true })
    plan.create("scripts/migrations.d/audit.ts", migrationModule("audit"), "audit migrations wiring")

    const notes = hasNotesExample(ctx)
    if (ctx.hasWorker()) {
      plan.create("apps/worker/src/audit-rules.ts", rulesFile(notes), "audit rule definitions")
      plan.create(
        "apps/worker/src/dispatch.d/audit.ts",
        `export const consumer = { name: "audit", events: ["*"] }\n`,
        "register audit as an event consumer",
      )
      plan.create("apps/worker/src/consumers.d/audit.ts", WORKER, "audit event consumer tick")
    } else {
      plan.create("apps/api/src/platform/audit-rules.ts", rulesFile(notes), "audit rules (add a worker to consume them)")
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
    target: (e) => ({ type: "note", id: idOf(e) }),
    summary: () => "created a note",
  }),
  defineAuditRule({
    event: "note.updated",
    action: "note.updated",
    target: (e) => ({ type: "note", id: idOf(e) }),
    summary: () => "updated a note",
  }),
  defineAuditRule({
    event: "note.deleted",
    action: "note.deleted",
    target: (e) => ({ type: "note", id: idOf(e) }),
    summary: () => "deleted a note",
  }),`
    : `  // defineAuditRule({
  //   event: "thing.created", action: "thing.created",
  //   target: (e) => ({ type: "thing", id: idOf(e) }), summary: () => "created a thing",
  // }),`
  return `import { createRuleSet, defineAuditRule, type AuditEvent } from "@obh/audit"

const idOf = (e: AuditEvent): string => String((e.payload as { id?: string }).id ?? "?")

// Map domain events to immutable audit entries.
export const auditRules = createRuleSet([
${rules}
])
`
}

const WORKER = `// Claims the "audit" deliveries and records immutable audit entries.
import { createAuditWorker, pgAdapter } from "@obh/audit"
import { auditRules } from "../audit-rules"
import type { WorkerContext } from "../context"

let worker: ReturnType<typeof createAuditWorker>

export function init(ctx: WorkerContext): void {
  worker = createAuditWorker({ db: pgAdapter(ctx.pool), rules: auditRules, instanceId: "worker" })
}

export async function tick(): Promise<void> {
  await worker.tick()
}
`
