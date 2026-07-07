import type { Capability } from "./types"
import { addPlatformPackage, hasNotesExample, migrationModule } from "./helpers"

export const events: Capability = {
  name: "events",
  describe: "Postgres event outbox + dispatcher — durable facts emitted inside your transactions",
  apply(ctx, plan) {
    addPlatformPackage(plan, ctx, "events", { api: true, worker: true })
    plan.create("scripts/migrations.d/events.ts", migrationModule("events"), "events migrations wiring")

    if (ctx.hasApp("api")) {
      plan.create("apps/api/src/platform/events.ts", registryFile(hasNotesExample(ctx)), "events registry + client")
      // Bridge the in-app bus to the durable outbox — same transaction as the write.
      plan.create("apps/api/src/bus.d/events-outbox.ts", OUTBOX, "forward domain facts to the outbox")
    }
    if (ctx.hasWorker()) {
      plan.create("apps/worker/src/consumers.d/events.ts", WORKER, "events dispatcher + delivery tick")
    }

    plan.patchManifest({ platform: { events: true } })
    plan.nextStep("Run `pnpm migrate`. Domain facts (e.g. note.created) now land in platform.events.")
  },
}

function registryFile(notes: boolean): string {
  const defs = notes
    ? `export const noteCreated = defineEvent({ name: "note.created" })
export const noteUpdated = defineEvent({ name: "note.updated" })
export const noteDeleted = defineEvent({ name: "note.deleted" })

const registry = createEventRegistry()
registry.register(noteCreated)
registry.register(noteUpdated)
registry.register(noteDeleted)`
    : `const registry = createEventRegistry()`
  return `// Adjust to the @obh/events version you install.
import { createEventClient, createEventRegistry, defineEvent, pgAdapter } from "@obh/events"
import { pool } from "../db"

${defs}

export { registry }
export const events = createEventClient({ db: pgAdapter(pool), registry })
`
}

const OUTBOX = `import { onEmit } from "../bus"
import { events } from "../platform/events"

// Every domain fact emitted on the bus is written to the durable outbox on the
// same transaction, so events can never be lost after a committed write.
onEmit(async (tx, name, payload) => {
  await events.emit(tx, name, payload)
})
`

const WORKER = `// Dispatches facts to consumers, then delivers (at-least-once, backoff, dead-letter).
import { createConsumerRunner, createEventDispatcher, pgAdapter } from "@obh/events"
import type { WorkerContext } from "../context"

let dispatcher: ReturnType<typeof createEventDispatcher>
let runner: ReturnType<typeof createConsumerRunner>

// Register consumers (notifications, audit, analytics, search, webhooks) here.
const consumers: any[] = []

export function init(ctx: WorkerContext): void {
  const db = pgAdapter(ctx.pool)
  dispatcher = createEventDispatcher({ db, consumers, batchSize: 50, instanceId: "worker" })
  runner = createConsumerRunner({ db, consumers, batchSize: 50, maxAttempts: 10, instanceId: "worker" })
}

export async function tick(): Promise<void> {
  await dispatcher.tick()
  await runner.tick()
}
`
