import type { Capability } from "./types"
import { addPlatformPackage, apiFramework, hasNotesExample, migrationModule } from "./helpers"

export const importExport: Capability = {
  name: "import-export",
  requires: ["files", "jobs"],
  describe: "CSV import/export engine — files in/out, run as background jobs",
  apply(ctx, plan) {
    addPlatformPackage(plan, ctx, "import-export", { api: true, worker: true })
    plan.create("scripts/migrations.d/import-export.ts", migrationModule("import-export"), "import-export migrations wiring")

    // defineImport fields carry Zod schemas; the FileStore port wires to @obh/files.
    if (ctx.hasApp("api")) {
      plan.addDependency("apps/api", "zod", "^3.23.8")
      plan.addDependency("apps/api", "@obh/files", "^0.1.0")
    }
    if (ctx.hasWorker()) {
      plan.addDependency("apps/worker", "zod", "^3.23.8")
      plan.addDependency("apps/worker", "@obh/files", "^0.1.0")
    }

    const notes = hasNotesExample(ctx)
    if (ctx.hasApp("api")) {
      plan.create("apps/api/src/platform/import-export.ts", apiPlatform(notes), "import/export registry + client")
      plan.create(
        "apps/api/src/routes/import-export.ts",
        apiFramework(ctx) === "hono" ? ROUTE_HONO : ROUTE_EXPRESS,
        "start CSV import/export routes",
      )
    }
    if (ctx.hasWorker()) {
      plan.create("apps/worker/src/consumers.d/import-export.ts", worker(notes), "import/export job worker tick")
    }

    plan.patchManifest({ platform: { "import-export": true } })
    plan.nextStep("Run `pnpm migrate`. Start imports/exports via the API; the worker runs them as jobs, reading/writing CSV through the files service.")
  },
}

// A FileStore port over @obh/files plus the import/export registry, shared by the
// API client and the worker (each builds its own — the worker never imports from
// apps/api). `pool` is passed in so this works at module scope or inside init().
function portBuilder(notes: boolean): string {
  const imports = notes
    ? `      defineImport({
        type: "note",
        fields: [
          { key: "title", label: "Title", required: true, schema: z.string().min(1) },
          { key: "body", label: "Body", schema: z.string().optional() },
        ],
        commitRow: async (_ctx, row) => {
          // Replace with your own domain write. Must be idempotent.
          const id = randomUUID()
          await pool.query("insert into notes (id, title, body) values ($1, $2, $3)", [
            id,
            String(row.mapped.title ?? ""),
            String(row.mapped.body ?? ""),
          ])
          return { entityType: "note", entityId: id }
        },
      }),`
    : `      // defineImport({ type: "thing", fields: [{ key: "name", label: "Name", required: true, schema: z.string().min(1) }], commitRow: async (ctx, row) => ({ entityType: "thing", entityId: "…" }) }),`
  const exports = notes
    ? `      defineExport({
        type: "note",
        columns: [
          { key: "title", label: "Title" },
          { key: "body", label: "Body" },
        ],
        loadRows: async () => {
          const res = await pool.query("select title, body from notes order by created_at desc")
          return res.rows as Array<Record<string, unknown>>
        },
      }),`
    : `      // defineExport({ type: "thing", columns: [{ key: "name", label: "Name" }], loadRows: async (ctx, filters) => [] }),`
  return `function buildClient(pool: Pool): ImportExportClient {
  const filesDb = filesPgAdapter(pool)
  const filesClient = createFilesClient({
    bucket: process.env.S3_BUCKET!,
    storage: createS3StorageProvider({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? "us-east-1",
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    }),
  })

  // read via a signed download URL; write by creating a file and PUTting the
  // bytes to its signed upload URL, then confirming the upload.
  const files: FileStore = {
    async read({ workspaceId, fileId }) {
      const { url } = await filesClient.createDownloadUrl(filesDb, { workspaceId, fileId })
      const res = await fetch(url)
      if (!res.ok) throw new Error(\`file download failed (\${res.status})\`)
      return Buffer.from(await res.arrayBuffer())
    },
    async create({ workspaceId, filename, contentType, content, createdBy }) {
      const upload = await filesClient.createUpload(filesDb, {
        workspaceId,
        originalName: filename,
        contentType,
        createdBy: createdBy ?? null,
      })
      const put = await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: upload.headers,
        body: typeof content === "string" ? content : content.toString("utf8"),
      })
      if (!put.ok) throw new Error(\`file upload failed (\${put.status})\`)
      await filesClient.completeUpload(filesDb, { workspaceId, fileId: upload.fileId })
      return { fileId: upload.fileId }
    },
  }

  const registry = createRegistry({
    imports: [
${imports}
    ],
    exports: [
${exports}
    ],
  })

  return createImportExportClient({ db: pgAdapter(pool), files, registry })
}`
}

function apiPlatform(notes: boolean): string {
  return `import { createFilesClient, createS3StorageProvider, pgAdapter as filesPgAdapter } from "@obh/files"
import {
  createImportExportClient,
  createRegistry,
  defineExport,
  defineImport,
  pgAdapter,
  type FileStore,
  type ImportExportClient,
} from "@obh/import-export"
import { randomUUID } from "node:crypto"
import type { Pool } from "pg"
import { z } from "zod"
import { pool } from "../db"

// Every platform row is scoped to a workspace. Single-tenant apps can leave this.
export const WORKSPACE = process.env.WORKSPACE_ID ?? "default"

${portBuilder(notes)}

export const importExport = buildClient(pool)
`
}

const ROUTE_HONO = `import type { Hono } from "hono"
import { createJobClient, pgAdapter as jobsPgAdapter } from "@obh/jobs"
import { importExport, WORKSPACE } from "../platform/import-export"
import { pool } from "../db"

// Processing runs in the background via @obh/jobs; the worker registers the
// handlers under these snake_case command names.
const jobs = createJobClient({ source: "api" })
const jobsDb = jobsPgAdapter(pool)

export function register(app: Hono): void {
  // Start an import over an already-uploaded CSV (sourceFileId from the files service).
  app.post("/api/imports", async (c) => {
    const body = await c.req.json<{ sourceFileId: string }>()
    const batch = await importExport.imports.createBatch({
      workspaceId: WORKSPACE,
      importType: "note",
      sourceFileId: body.sourceFileId,
    })
    await jobs.enqueue(jobsDb, "import_parse_csv", {
      workspaceId: WORKSPACE,
      payload: { workspaceId: WORKSPACE, batchId: batch.id },
    })
    return c.json(batch, 202)
  })

  // Start an export; the worker generates the CSV and stores it via files.
  app.post("/api/exports", async (c) => {
    const exp = await importExport.exports.createExport({
      workspaceId: WORKSPACE,
      exportType: "note",
    })
    await jobs.enqueue(jobsDb, "export_generate_csv", {
      workspaceId: WORKSPACE,
      payload: { workspaceId: WORKSPACE, exportId: exp.id },
    })
    return c.json(exp, 202)
  })
}
`

const ROUTE_EXPRESS = `import type { Express, Request, Response } from "express"
import { createJobClient, pgAdapter as jobsPgAdapter } from "@obh/jobs"
import { importExport, WORKSPACE } from "../platform/import-export"
import { pool } from "../db"

const jobs = createJobClient({ source: "api" })
const jobsDb = jobsPgAdapter(pool)

export function register(app: Express): void {
  app.post("/api/imports", async (req: Request, res: Response) => {
    const batch = await importExport.imports.createBatch({
      workspaceId: WORKSPACE,
      importType: "note",
      sourceFileId: req.body.sourceFileId,
    })
    await jobs.enqueue(jobsDb, "import_parse_csv", {
      workspaceId: WORKSPACE,
      payload: { workspaceId: WORKSPACE, batchId: batch.id },
    })
    res.status(202).json(batch)
  })

  app.post("/api/exports", async (_req: Request, res: Response) => {
    const exp = await importExport.exports.createExport({
      workspaceId: WORKSPACE,
      exportType: "note",
    })
    await jobs.enqueue(jobsDb, "export_generate_csv", {
      workspaceId: WORKSPACE,
      payload: { workspaceId: WORKSPACE, exportId: exp.id },
    })
    res.status(202).json(exp)
  })
}
`

function worker(notes: boolean): string {
  return `// Job-driven CSV pipeline. createImportWorker/createExportWorker expose handlers
// keyed by the recommended (dotted) job names; we register them with @obh/jobs
// under snake_case commands the API enqueues, then drain the queue each tick.
import { createFilesClient, createS3StorageProvider, pgAdapter as filesPgAdapter } from "@obh/files"
import {
  createExportWorker,
  createImportExportClient,
  createImportWorker,
  createRegistry,
  defineExport,
  defineImport,
  pgAdapter,
  type FileStore,
  type ImportExportClient,
} from "@obh/import-export"
import { createJobRegistry, createWorker, defineJob, pgAdapter as jobsPgAdapter } from "@obh/jobs"
import { randomUUID } from "node:crypto"
import type { Pool } from "pg"
import { z } from "zod"
import type { WorkerContext } from "../context"

let worker: ReturnType<typeof createWorker>

${portBuilder(notes)}

export function init(ctx: WorkerContext): void {
  const client = buildClient(ctx.pool)
  const imp = createImportWorker(client)
  const exp = createExportWorker(client)

  // Each qport handler validates its own payload (workspaceId + batch/export id),
  // so the job schema stays permissive.
  const registry = createJobRegistry([
    defineJob({ name: "import_parse_csv", version: 1, schema: z.any(), handler: (_c, p) => imp.handlers["import.parse_csv"](p) }),
    defineJob({ name: "import_validate_batch", version: 1, schema: z.any(), handler: (_c, p) => imp.handlers["import.validate_batch"](p) }),
    defineJob({ name: "import_commit_batch", version: 1, schema: z.any(), handler: (_c, p) => imp.handlers["import.commit_batch"](p) }),
    defineJob({ name: "export_generate_csv", version: 1, schema: z.any(), handler: (_c, p) => exp.handlers["export.generate_csv"](p) }),
  ])

  worker = createWorker({ db: jobsPgAdapter(ctx.pool), registry, instanceId: "worker" })
}

export async function tick(): Promise<void> {
  await worker.tick()
}
`
}
