import type { Capability } from "./types"
import { addPlatformPackage, apiFramework, hasNotesExample, migrationModule } from "./helpers"

export const importExport: Capability = {
  name: "import-export",
  requires: ["files", "jobs"],
  describe: "CSV import/export engine — streamed through files, run as background jobs",
  apply(ctx, plan) {
    addPlatformPackage(plan, ctx, "import-export", { api: true, worker: true })
    plan.create("scripts/migrations.d/import-export.ts", migrationModule("import-export"), "import-export migrations wiring")

    const notes = hasNotesExample(ctx)
    if (ctx.hasApp("api")) {
      plan.create("apps/api/src/platform/import-export.ts", registryFile(notes), "import/export registry + client")
      plan.create("apps/api/src/routes/import-export.ts", apiFramework(ctx) === "hono" ? ROUTE_HONO : ROUTE_EXPRESS, "notes CSV import/export routes")
    }
    if (ctx.hasWorker()) {
      plan.create("apps/worker/src/consumers.d/import-export.ts", WORKER, "import/export worker ticks")
    }

    plan.patchManifest({ platform: { "import-export": true } })
    plan.nextStep("Run `pnpm migrate`. Imports/exports run as jobs and stream CSV via the files service.")
  },
}

function registryFile(notes: boolean): string {
  const defs = notes
    ? `// Map CSV rows to/from the notes domain.
export const notesImport = defineImport({
  name: "notes",
  columns: ["title", "body"],
})
export const notesExport = defineExport({
  name: "notes",
  query: "select title, body from notes order by created_at",
})

const registry = createRegistry()
registry.register(notesImport)
registry.register(notesExport)`
    : `const registry = createRegistry()`
  return `// Adjust to the @obh/import-export version you install.
import { createImportExportClient, createRegistry, defineExport, defineImport, pgAdapter } from "@obh/import-export"
import { pool } from "../db"

${defs}

export { registry }
export const importExport = createImportExportClient({ db: pgAdapter(pool), registry })
`
}

const ROUTE_HONO = `import type { Hono } from "hono"
import { importExport } from "../platform/import-export"

export function register(app: Hono): void {
  // Kick off a CSV import (fileId points at an already-uploaded file).
  app.post("/notes/import", async (c) => {
    const body = await c.req.json<{ fileId: string; workspaceId: string }>()
    return c.json(await importExport.startImport("notes", body), 202)
  })

  // Kick off a CSV export; returns a job whose result is a downloadable fileId.
  app.get("/notes/export", async (c) => {
    return c.json(await importExport.startExport("notes", { workspaceId: c.req.query("workspaceId") }), 202)
  })
}
`

const ROUTE_EXPRESS = `import type { Express, Request, Response } from "express"
import { importExport } from "../platform/import-export"

export function register(app: Express): void {
  app.post("/notes/import", async (req: Request, res: Response) => {
    res.status(202).json(await importExport.startImport("notes", req.body))
  })

  app.get("/notes/export", async (req: Request, res: Response) => {
    res.status(202).json(await importExport.startExport("notes", { workspaceId: req.query.workspaceId as string | undefined }))
  })
}
`

const WORKER = `// Runs queued import and export jobs: parse/validate CSV, upsert rows, or
// stream query results back out to a file.
import { createExportWorker, createImportWorker, pgAdapter } from "@obh/import-export"
import { registry } from "../platform/import-export"
import type { WorkerContext } from "../context"

let importWorker: ReturnType<typeof createImportWorker>
let exportWorker: ReturnType<typeof createExportWorker>

export function init(ctx: WorkerContext): void {
  const db = pgAdapter(ctx.pool)
  importWorker = createImportWorker({ db, registry })
  exportWorker = createExportWorker({ db, registry })
}

export async function tick(): Promise<void> {
  await importWorker.tick()
  await exportWorker.tick()
}
`
