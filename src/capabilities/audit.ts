import type { Capability } from "./types"
import { addPlatformPackage, migrationModule } from "./helpers"

export const audit: Capability = {
  name: "audit",
  requires: ["events"],
  describe: "Immutable who-did-what-to-what trail, derived from events",
  apply(ctx, plan) {
    addPlatformPackage(plan, ctx, "audit", { worker: true })
    plan.create("scripts/migrations.d/audit.ts", migrationModule("audit"), "audit migrations wiring")

    if (ctx.hasWorker()) {
      // Rules live in the worker app so the consumer can import them without
      // crossing app boundaries (which would break the worker's tsc rootDir).
      plan.create("apps/worker/src/audit-rules.ts", AUDIT_RULES, "audit rule definitions")
      plan.create("apps/worker/src/consumers.d/audit.ts", AUDIT_WORKER, "audit event consumer tick")
    } else {
      plan.create("apps/api/src/platform/audit-rules.ts", AUDIT_RULES, "audit rule definitions (add a worker to consume them)")
    }

    plan.patchManifest({ platform: { audit: true } })
    plan.nextStep("Run `pnpm migrate`. Define audit rules in apps/worker/src/audit-rules.ts.")
  },
}

const AUDIT_RULES = `// Adjust to the @obh/audit version you install.
import { defineAuditRule, createRuleSet } from "@obh/audit"

// Map domain events to immutable audit entries.
export const auditRules = createRuleSet([
  defineAuditRule({
    event: "example.pinged",
    action: "example.pinged",
    target: () => ({ type: "example", id: "ping" }),
  }),
])
`

const AUDIT_WORKER = `// Consumes events and records audit entries. Reads platform.event_deliveries
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
