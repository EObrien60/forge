import type { Capability } from "./types"
import { addPlatformPackage, migrationModule } from "./helpers"

export const events: Capability = {
  name: "events",
  describe: "Postgres event outbox + dispatcher (facts emitted inside your transactions)",
  apply(ctx, plan) {
    addPlatformPackage(plan, ctx, "events", { api: true, worker: true })
    plan.create("scripts/migrations.d/events.ts", migrationModule("events"), "events migrations wiring")

    if (ctx.hasApp("api")) {
      plan.create("apps/api/src/platform/events.ts", EVENTS_API, "events registry + client")
      plan.create("apps/api/src/routes/events-example.ts", EVENTS_ROUTE, "example emit route")
    }
    if (ctx.hasWorker()) {
      plan.create("apps/worker/src/consumers.d/events.ts", EVENTS_WORKER, "events dispatcher/runner tick")
    }

    plan.patchManifest({ platform: { events: true } })
    plan.nextStep("Run `pnpm migrate` to create platform.events, then emit `example.pinged` via POST /examples/ping.")
  },
}

const EVENTS_API = `// Adjust to the @obh/events version you install.
import { createEventClient, createEventRegistry, defineEvent, pgAdapter } from "@obh/events"
import { pool } from "../db"

export const examplePinged = defineEvent({ name: "example.pinged" })

export const registry = createEventRegistry()
registry.register(examplePinged)

// emit() runs inside the caller's transaction; here it uses the shared pool.
export const events = createEventClient({ db: pgAdapter(pool), registry })
`

const EVENTS_ROUTE = `import type { Hono } from "hono"
import { events, examplePinged } from "../platform/events"

export function register(app: Hono): void {
  app.post("/examples/ping", async (c) => {
    await events.emit(examplePinged, { at: new Date().toISOString() })
    return c.json({ emitted: "example.pinged" })
  })
}
`

const EVENTS_WORKER = `// Drives the events outbox: dispatch facts to consumers, then deliver.
import { createConsumerRunner, createEventDispatcher, pgAdapter } from "@obh/events"
import type { WorkerContext } from "../context"

let dispatcher: ReturnType<typeof createEventDispatcher>
let runner: ReturnType<typeof createConsumerRunner>

// Register your consumers here (notifications, audit, analytics, …).
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
