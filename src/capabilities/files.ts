import type { Capability } from "./types"
import { addPlatformPackage, apiFramework, migrationModule } from "./helpers"

export const files: Capability = {
  name: "files",
  describe: "File metadata + signed URLs over S3-compatible storage (product handles file_id only)",
  apply(ctx, plan) {
    addPlatformPackage(plan, ctx, "files", { api: true })
    plan.create("scripts/migrations.d/files.ts", migrationModule("files"), "files migrations wiring")

    if (ctx.hasApp("api")) {
      plan.create("apps/api/src/platform/files.ts", CLIENT, "files client")
      plan.create("apps/api/src/routes/files.ts", apiFramework(ctx) === "hono" ? ROUTE_HONO : ROUTE_EXPRESS, "signed upload/download routes")
    }

    plan.addEnvVar({ name: "S3_ENDPOINT", example: "http://localhost:9000", comment: "S3-compatible endpoint (MinIO in dev)" })
    plan.addEnvVar({ name: "S3_REGION", example: "us-east-1" })
    plan.addEnvVar({ name: "S3_BUCKET", example: `${ctx.manifest?.name ?? "app"}-files` })
    plan.addEnvVar({ name: "S3_ACCESS_KEY_ID", example: "minioadmin", comment: "secret in prod — set via lwd secret set", secret: true })
    plan.addEnvVar({ name: "S3_SECRET_ACCESS_KEY", example: "minioadmin", comment: "secret in prod — set via lwd secret set", secret: true })

    plan.patchManifest({ platform: { files: true } })
    plan.nextStep("Run `pnpm migrate`. For local dev run MinIO and create the S3_BUCKET.")
  },
}

const CLIENT = `// Adjust to the @obh/files version you install.
import { createFilesClient, createS3StorageProvider, pgAdapter } from "@obh/files"
import { pool } from "../db"

const storage = createS3StorageProvider({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  bucket: process.env.S3_BUCKET!,
  accessKeyId: process.env.S3_ACCESS_KEY_ID!,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
})

export const files = createFilesClient({ db: pgAdapter(pool), storage })
`

const ROUTE_HONO = `import type { Hono } from "hono"
import { files } from "../platform/files"

export function register(app: Hono): void {
  // 1. Client asks for a signed URL, then PUTs bytes straight to storage.
  app.post("/files/upload-url", async (c) => {
    const body = await c.req.json<{ filename: string; workspaceId: string }>()
    return c.json(await files.createUpload({ filename: body.filename, workspaceId: body.workspaceId }))
  })

  // 2. Client confirms the upload completed (server verifies via HEAD).
  app.post("/files/:id/complete", async (c) => {
    return c.json(await files.completeUpload(c.req.param("id")))
  })

  app.get("/files/:id/download-url", async (c) => {
    return c.json({ url: await files.createDownloadUrl(c.req.param("id")) })
  })
}
`

const ROUTE_EXPRESS = `import type { Express, Request, Response } from "express"
import { files } from "../platform/files"

export function register(app: Express): void {
  app.post("/files/upload-url", async (req: Request, res: Response) => {
    res.json(await files.createUpload({ filename: req.body.filename, workspaceId: req.body.workspaceId }))
  })

  app.post("/files/:id/complete", async (req: Request, res: Response) => {
    res.json(await files.completeUpload(req.params.id))
  })

  app.get("/files/:id/download-url", async (req: Request, res: Response) => {
    res.json({ url: await files.createDownloadUrl(req.params.id) })
  })
}
`
