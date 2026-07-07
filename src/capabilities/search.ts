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
      plan.create("apps/api/src/platform/search.ts", registryFile(notes), "search client + entities")
      plan.create("apps/api/src/routes/search.ts", apiFramework(ctx) === "hono" ? ROUTE_HONO : ROUTE_EXPRESS, "search query route")
    }
    if (ctx.hasWorker()) {
      plan.create("apps/worker/src/consumers.d/search.ts", WORKER, "search indexer tick")
    }

    plan.patchManifest({ platform: { search: true } })
    plan.nextStep("Run `pnpm migrate` (the @obh/search migration enables pg_trgm). Index is updated by the worker from events.")
  },
}

function registryFile(notes: boolean): string {
  const defs = notes
    ? `// Declare a searchable entity and how its indexed document is shaped.
export const noteEntity = defineSearchEntity({
  type: "note",
  fields: ["title", "body"],
})

const entities = [noteEntity]`
    : `const entities: unknown[] = []`
  return `// Adjust to the @obh/search version you install.
// Requires the pg_trgm extension — the @obh/search migration enables it.
import { createPostgresSearchProvider, createSearchClient, defineSearchEntity, pgAdapter } from "@obh/search"
import { pool } from "../db"

${defs}

const provider = createPostgresSearchProvider({ db: pgAdapter(pool) })
export const search = createSearchClient({ provider, entities })
`
}

const ROUTE_HONO = `import type { Hono } from "hono"
import { search } from "../platform/search"

export function register(app: Hono): void {
  app.get("/search", async (c) => {
    const q = c.req.query("q") ?? ""
    return c.json(await search.query({ q, workspaceId: c.req.query("workspaceId") }))
  })
}
`

const ROUTE_EXPRESS = `import type { Express, Request, Response } from "express"
import { search } from "../platform/search"

export function register(app: Express): void {
  app.get("/search", async (req: Request, res: Response) => {
    res.json(await search.query({ q: (req.query.q as string) ?? "", workspaceId: req.query.workspaceId as string | undefined }))
  })
}
`

const WORKER = `// Consumes note.* events and keeps the search index in sync (upsert/delete docs).
import { createSearchWorker, pgAdapter } from "@obh/search"
import type { WorkerContext } from "../context"

let worker: ReturnType<typeof createSearchWorker>

export function init(ctx: WorkerContext): void {
  worker = createSearchWorker({
    db: pgAdapter(ctx.pool),
    index: {
      "note.created": (p: { id: string; title: string; body: string }) => ({ type: "note", id: p.id, doc: p }),
      "note.updated": (p: { id: string; title: string; body: string }) => ({ type: "note", id: p.id, doc: p }),
      "note.deleted": (p: { id: string }) => ({ type: "note", id: p.id, delete: true }),
    },
  })
}

export async function tick(): Promise<void> {
  await worker.tick()
}
`
