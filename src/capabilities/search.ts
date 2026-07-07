import type { Capability } from "./types"
import { addPlatformPackage, apiFramework, hasNotesExample, migrationModule } from "./helpers"

export const search: Capability = {
  name: "search",
  requires: ["events"],
  describe: "Workspace search + indexing — Postgres full-text/trigram, kept fresh from events",
  apply(ctx, plan) {
    addPlatformPackage(plan, ctx, "search", { api: true, worker: true })
    plan.create("scripts/migrations.d/search.ts", migrationModule("search"), "search migrations wiring")

    const notes = hasNotesExample(ctx)
    if (ctx.hasApp("api")) {
      plan.create("apps/api/src/platform/search.ts", CLIENT, "search client + query provider")
      plan.create(
        "apps/api/src/routes/search.ts",
        apiFramework(ctx) === "hono" ? ROUTE_HONO : ROUTE_EXPRESS,
        "search query route",
      )
    }
    if (ctx.hasWorker()) {
      plan.create("apps/worker/src/search-entities.ts", entitiesFile(notes), "worker-side search entity definitions")
      plan.create(
        "apps/worker/src/dispatch.d/search.ts",
        `export const consumer = { name: "search", events: ["*"] }\n`,
        "register search as an event consumer",
      )
      plan.create("apps/worker/src/consumers.d/search.ts", WORKER, "search indexer tick")
    }

    plan.patchManifest({ platform: { search: true } })
    plan.nextStep("Run `pnpm migrate` (the @obh/search migration enables pg_trgm). The worker keeps the index fresh from events; query at GET /api/search?q=.")
  },
}

// The client only needs the query provider; entity mappers live worker-side.
const CLIENT = `import { createPostgresSearchProvider, createSearchClient, pgAdapter } from "@obh/search"
import { pool } from "../db"

// Postgres full-text + trigram provider. pg_trgm is enabled by the migration.
const provider = createPostgresSearchProvider({ db: pgAdapter(pool) })

export const search = createSearchClient({ provider })
`

function entitiesFile(notes: boolean): string {
  const defs = notes
    ? `  defineSearchEntity({
    type: "note",
    events: ["note.created", "note.updated"],
    deleteEvents: ["note.deleted"],
    buildDocument: (_ctx, event) => {
      const p = event.payload as { id: string; title?: string; body?: string }
      return {
        workspaceId: event.workspaceId,
        entityType: "note",
        entityId: p.id,
        title: p.title ?? "",
        content: p.body ?? "",
      }
    },
    buildDeleteRef: (_ctx, event) => {
      const p = event.payload as { id: string }
      return { workspaceId: event.workspaceId, entityType: "note", entityId: p.id }
    },
  }),`
    : `  // defineSearchEntity({
  //   type: "thing",
  //   events: ["thing.created", "thing.updated"],
  //   deleteEvents: ["thing.deleted"],
  //   buildDocument: (_ctx, event) => ({ workspaceId: event.workspaceId, entityType: "thing", entityId: String((event.payload as { id: string }).id), title: "…", content: "…" }),
  //   buildDeleteRef: (_ctx, event) => ({ workspaceId: event.workspaceId, entityType: "thing", entityId: String((event.payload as { id: string }).id) }),
  // }),`
  return `import { defineSearchEntity, type SearchEntityDefinition } from "@obh/search"

// Worker-side entity definitions: how domain events become search documents.
// Kept here so the worker never imports across app boundaries.
export const entities: SearchEntityDefinition[] = [
${defs}
]
`
}

const ROUTE_HONO = `import type { Hono } from "hono"
import { search } from "../platform/search"
import { WORKSPACE } from "../platform/events"

export function register(app: Hono): void {
  app.get("/api/search", async (c) => {
    const q = c.req.query("q") ?? ""
    return c.json(await search.query({ workspaceId: WORKSPACE, query: q }))
  })
}
`

const ROUTE_EXPRESS = `import type { Express, Request, Response } from "express"
import { search } from "../platform/search"
import { WORKSPACE } from "../platform/events"

export function register(app: Express): void {
  app.get("/api/search", async (req: Request, res: Response) => {
    const q = (req.query.q as string) ?? ""
    res.json(await search.query({ workspaceId: WORKSPACE, query: q }))
  })
}
`

const WORKER = `// Claims the "search" event deliveries and keeps the index in sync. The search
// worker exposes an events consumer (index on create/update, unindex on delete);
// createConsumerRunner drives it against this consumer's deliveries.
import { createConsumerRunner, pgAdapter } from "@obh/events"
import { createPostgresSearchProvider, createSearchClient, createSearchWorker, pgAdapter as searchPgAdapter } from "@obh/search"
import { entities } from "../search-entities"
import type { WorkerContext } from "../context"

let runner: ReturnType<typeof createConsumerRunner>

export function init(ctx: WorkerContext): void {
  const provider = createPostgresSearchProvider({ db: searchPgAdapter(ctx.pool) })
  const client = createSearchClient({ provider })
  // deps are passed to mappers as ctx.db; the note mappers read straight from
  // the event payload, so nothing product-specific is needed here.
  const worker = createSearchWorker<unknown>({ client, entities, deps: undefined })
  runner = createConsumerRunner({
    db: pgAdapter(ctx.pool),
    consumers: [worker.consumer],
    instanceId: "worker",
  })
}

export async function tick(): Promise<void> {
  await runner.tick()
}
`
