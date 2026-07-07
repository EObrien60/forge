import type { Capability } from "./types"
import { addPlatformPackage, hasNotesExample, migrationModule } from "./helpers"

export const events: Capability = {
  name: "events",
  describe: "Postgres event outbox + dispatcher — durable facts emitted inside your transactions",
  apply(ctx, plan) {
    addPlatformPackage(plan, ctx, "events", { api: true, worker: true })
    // defineEvent requires a zod schema; events peer-depends on zod.
    if (ctx.hasApp("api")) plan.addDependency("apps/api", "zod", "^3.23.8")
    plan.create("scripts/migrations.d/events.ts", migrationModule("events"), "events migrations wiring")

    if (ctx.hasApp("api")) {
      plan.create("apps/api/src/platform/events.ts", registryFile(hasNotesExample(ctx)), "events registry + client")
      // Bridge the in-app bus to the durable outbox — same transaction as the write.
      plan.create("apps/api/src/bus.d/events-outbox.ts", OUTBOX, "forward domain facts to the outbox")
    }
    if (ctx.hasWorker()) {
      plan.create("apps/worker/src/dispatch.d/.gitkeep", "", "event-consumer registration directory")
      plan.create("apps/worker/src/consumers.d/events.ts", WORKER, "events dispatcher (fans facts to registered consumers)")
    }

    plan.patchManifest({ platform: { events: true } })
    plan.nextStep("Run `pnpm migrate` — domain facts land in platform.events and fan out to consumers.")
  },
}

function registryFile(notes: boolean): string {
  const defs = notes
    ? `const notePayload = z.object({ id: z.string() }).passthrough()

export const noteCreated = defineEvent({ name: "note.created", version: 1, schema: notePayload })
export const noteUpdated = defineEvent({ name: "note.updated", version: 1, schema: notePayload })
export const noteDeleted = defineEvent({ name: "note.deleted", version: 1, schema: notePayload })

export const registry = createEventRegistry([noteCreated, noteUpdated, noteDeleted])`
    : `// Declare your domain facts, e.g.:
// export const thingCreated = defineEvent({ name: "thing.created", version: 1, schema: z.object({ id: z.string() }) })
export const registry = createEventRegistry([])`
  return `import { z } from "zod"
import { createEventClient, createEventRegistry, defineEvent, type EventDb } from "@obh/events"

// Every platform row is scoped to a workspace. Single-tenant apps can leave this.
export const WORKSPACE = process.env.WORKSPACE_ID ?? "default"

${defs}

export const events = createEventClient({ source: "app", registry })

/** Adapt a raw pg transaction to the structural EventDb @obh/events expects. */
export function asEventDb(tx: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }): EventDb {
  return { query: (sql: string, params?: unknown[]) => tx.query(sql, params) as never }
}
`
}

const OUTBOX = `import { onEmit } from "../bus"
import { asEventDb, events, WORKSPACE } from "../platform/events"

// Every domain fact emitted on the bus is written to the durable @obh/events
// outbox on the SAME transaction, so nothing is lost after a committed write.
onEmit(async (tx, name, payload) => {
  await events.emit(asEventDb(tx), name, { workspaceId: WORKSPACE, payload })
})
`

const WORKER = `// Fans new events into per-consumer deliveries. Each event-consuming capability
// (analytics, audit, search, …) drops a { name, events } registration into
// dispatch.d/; this loads them so their deliveries get created.
import { createEventDispatcher, pgAdapter } from "@obh/events"
import { readdirSync } from "node:fs"
import path from "node:path"
import type { WorkerContext } from "../context"

interface DispatchConsumer {
  name: string
  events: string[]
}

function loadDispatchConsumers(): DispatchConsumer[] {
  const dir = path.join(__dirname, "..", "dispatch.d")
  const out: DispatchConsumer[] = []
  try {
    for (const file of readdirSync(dir).sort()) {
      if (!/\\.(ts|js)$/.test(file) || file.endsWith(".d.ts")) continue
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(path.join(dir, file))
      if (mod.consumer) out.push(mod.consumer as DispatchConsumer)
    }
  } catch {
    // no dispatch.d yet
  }
  return out
}

let dispatcher: ReturnType<typeof createEventDispatcher>

export function init(ctx: WorkerContext): void {
  dispatcher = createEventDispatcher({
    db: pgAdapter(ctx.pool),
    instanceId: "worker",
    consumers: loadDispatchConsumers(),
  })
}

export async function tick(): Promise<void> {
  await dispatcher.tick()
}
`
