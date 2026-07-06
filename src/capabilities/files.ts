import type { Capability } from "./types"
import { addPlatformPackage, migrationModule } from "./helpers"

export const files: Capability = {
  name: "files",
  describe: "File metadata + signed URLs over S3-compatible storage (product handles file_id only)",
  apply(ctx, plan) {
    addPlatformPackage(plan, ctx, "files", { api: true })
    plan.create("scripts/migrations.d/files.ts", migrationModule("files"), "files migrations wiring")

    if (ctx.hasApp("api")) {
      plan.create("apps/api/src/platform/files.ts", FILES_API, "files client")
      plan.create("apps/api/src/routes/files-example.ts", FILES_ROUTE, "example upload/download routes")
    }

    plan.addEnvVar({ name: "S3_ENDPOINT", example: "http://localhost:9000", comment: "S3-compatible endpoint (MinIO in dev)" })
    plan.addEnvVar({ name: "S3_REGION", example: "us-east-1" })
    plan.addEnvVar({ name: "S3_BUCKET", example: `${ctx.manifest?.name ?? "app"}-files` })
    plan.addEnvVar({ name: "S3_ACCESS_KEY_ID", example: "", comment: "secret — set via lwd secret set", secret: true })
    plan.addEnvVar({ name: "S3_SECRET_ACCESS_KEY", example: "", comment: "secret — set via lwd secret set", secret: true })

    plan.patchManifest({ platform: { files: true } })
    plan.nextStep("Run `pnpm migrate`. For local dev, run MinIO and create the S3_BUCKET.")
  },
}

const FILES_API = `// Adjust to the @obh/files version you install.
import { createFilesClient, createS3StorageProvider } from "@obh/files"
import { pgAdapter } from "@obh/files"
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

const FILES_ROUTE = `import type { Hono } from "hono"
import { files } from "../platform/files"

export function register(app: Hono): void {
  // Client asks for a signed upload URL, PUTs bytes directly to storage.
  app.post("/files/upload-url", async (c) => {
    const body = await c.req.json<{ filename: string; workspaceId: string }>()
    const upload = await files.createUpload({ filename: body.filename, workspaceId: body.workspaceId })
    return c.json(upload)
  })

  app.get("/files/:id/download-url", async (c) => {
    const url = await files.createDownloadUrl(c.req.param("id"))
    return c.json({ url })
  })
}
`
