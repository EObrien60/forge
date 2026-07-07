import type { Capability } from "./types"
import { addPlatformPackage, apiFramework, migrationModule } from "./helpers"

export const files: Capability = {
  name: "files",
  describe: "File metadata + signed URLs over S3-compatible storage (product handles file_id only)",
  apply(ctx, plan) {
    addPlatformPackage(plan, ctx, "files", { api: true })
    plan.create("scripts/migrations.d/files.ts", migrationModule("files"), "files migrations wiring")

    if (ctx.hasApp("api")) {
      plan.create("apps/api/src/platform/files.ts", CLIENT, "files client + S3 storage provider")
      plan.create("apps/api/src/routes/files.ts", apiFramework(ctx) === "hono" ? ROUTE_HONO : ROUTE_EXPRESS, "signed upload/download routes")
    }

    plan.addEnvVar({ name: "S3_ENDPOINT", example: "http://localhost:9000", comment: "S3-compatible endpoint (MinIO in dev); omit for real AWS S3" })
    plan.addEnvVar({ name: "S3_REGION", example: "us-east-1" })
    plan.addEnvVar({ name: "S3_BUCKET", example: `${ctx.manifest?.name ?? "app"}-files` })
    plan.addEnvVar({ name: "S3_ACCESS_KEY_ID", example: "minioadmin", comment: "secret in prod — set via lwd secret set", secret: true })
    plan.addEnvVar({ name: "S3_SECRET_ACCESS_KEY", example: "minioadmin", comment: "secret in prod — set via lwd secret set", secret: true })

    plan.patchManifest({ platform: { files: true } })
    plan.nextStep("Run `pnpm migrate`. For local dev run MinIO and create the S3_BUCKET.")
  },
}

const CLIENT = `import { createFilesClient, createS3StorageProvider, pgAdapter } from "@obh/files"
import { pool } from "../db"

// Every platform row is scoped to a workspace. Single-tenant apps can leave this.
export const WORKSPACE = process.env.WORKSPACE_ID ?? "default"

// S3-compatible provider: AWS S3, MinIO, Cloudflare R2, Backblaze B2, etc.
// forcePathStyle defaults to true whenever an endpoint is set (MinIO needs it).
const storage = createS3StorageProvider({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "us-east-1",
  accessKeyId: process.env.S3_ACCESS_KEY_ID!,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
})

// The bucket lives on the client; the storage provider is bucket-agnostic.
export const files = createFilesClient({ storage, bucket: process.env.S3_BUCKET! })

// Client methods take a db/tx handle as their first argument so metadata writes
// can join a transaction. Here we hand them a pool-backed adapter.
export const filesDb = pgAdapter(pool)
`

const ROUTE_HONO = `import type { Hono } from "hono"
import { files, filesDb, WORKSPACE } from "../platform/files"

export function register(app: Hono): void {
  // 1. Ask for a signed upload URL, then PUT the bytes straight to storage.
  app.post("/files/upload-url", async (c) => {
    const body = await c.req.json<{ originalName?: string; contentType?: string; sizeBytes?: number }>()
    if (!body.originalName) return c.json({ error: "originalName is required" }, 400)
    return c.json(
      await files.createUpload(filesDb, {
        workspaceId: WORKSPACE,
        originalName: body.originalName,
        contentType: body.contentType ?? null,
        sizeBytes: body.sizeBytes ?? null,
      }),
    )
  })

  // 2. Confirm the upload completed (the server verifies via a HEAD request).
  app.post("/files/:id/complete", async (c) => {
    return c.json(await files.completeUpload(filesDb, { workspaceId: WORKSPACE, fileId: c.req.param("id") }))
  })

  // 3. Hand back a short-lived signed download URL.
  app.get("/files/:id/download-url", async (c) => {
    return c.json(await files.createDownloadUrl(filesDb, { workspaceId: WORKSPACE, fileId: c.req.param("id") }))
  })
}
`

const ROUTE_EXPRESS = `import type { Express, Request, Response } from "express"
import { files, filesDb, WORKSPACE } from "../platform/files"

export function register(app: Express): void {
  app.post("/files/upload-url", async (req: Request, res: Response) => {
    if (!req.body.originalName) return res.status(400).json({ error: "originalName is required" })
    res.json(
      await files.createUpload(filesDb, {
        workspaceId: WORKSPACE,
        originalName: req.body.originalName,
        contentType: req.body.contentType ?? null,
        sizeBytes: req.body.sizeBytes ?? null,
      }),
    )
  })

  app.post("/files/:id/complete", async (req: Request, res: Response) => {
    res.json(await files.completeUpload(filesDb, { workspaceId: WORKSPACE, fileId: req.params.id }))
  })

  app.get("/files/:id/download-url", async (req: Request, res: Response) => {
    res.json(await files.createDownloadUrl(filesDb, { workspaceId: WORKSPACE, fileId: req.params.id }))
  })
}
`
