import type { Capability } from "./types"
import { addPlatformPackage, apiFramework, migrationModule } from "./helpers"

export const webhooks: Capability = {
  name: "webhooks",
  requires: ["events"],
  describe: "Outbound webhook delivery — signed, retried, dead-lettered; endpoints managed per workspace",
  apply(ctx, plan) {
    addPlatformPackage(plan, ctx, "webhooks", { api: true, worker: true })
    plan.create("scripts/migrations.d/webhooks.ts", migrationModule("webhooks"), "webhooks migrations wiring")

    if (ctx.hasApp("api")) {
      plan.create("apps/api/src/platform/webhooks.ts", CLIENT, "webhooks client")
      plan.create("apps/api/src/routes/webhooks.ts", apiFramework(ctx) === "hono" ? ROUTE_HONO : ROUTE_EXPRESS, "manage webhook endpoints")
    }
    if (ctx.hasWorker()) {
      plan.create("apps/worker/src/consumers.d/webhooks.ts", WORKER, "webhook delivery tick")
    }

    plan.addEnvVar({ name: "WEBHOOK_SECRET_ENCRYPTION_KEY", example: "change-me-32-bytes-min", comment: "encrypts per-endpoint signing secrets at rest", secret: true })

    plan.patchManifest({ platform: { webhooks: true } })
    plan.nextStep("Run `pnpm migrate` and set WEBHOOK_SECRET_ENCRYPTION_KEY. Deliveries are queued from events and sent by the worker.")
  },
}

const CLIENT = `// Adjust to the @obh/webhooks version you install.
import { createWebhooksClient, pgAdapter } from "@obh/webhooks"
import { pool } from "../db"

export const webhooks = createWebhooksClient({
  db: pgAdapter(pool),
  encryptionKey: process.env.WEBHOOK_SECRET_ENCRYPTION_KEY!,
})
`

const ROUTE_HONO = `import type { Hono } from "hono"
import { webhooks } from "../platform/webhooks"

export function register(app: Hono): void {
  app.post("/webhooks/endpoints", async (c) => {
    const body = await c.req.json<{ workspaceId: string; url: string; events: string[] }>()
    return c.json(await webhooks.createEndpoint(body), 201)
  })

  app.get("/webhooks/endpoints", async (c) => {
    return c.json(await webhooks.listEndpoints({ workspaceId: c.req.query("workspaceId") }))
  })
}
`

const ROUTE_EXPRESS = `import type { Express, Request, Response } from "express"
import { webhooks } from "../platform/webhooks"

export function register(app: Express): void {
  app.post("/webhooks/endpoints", async (req: Request, res: Response) => {
    res.status(201).json(await webhooks.createEndpoint(req.body))
  })

  app.get("/webhooks/endpoints", async (req: Request, res: Response) => {
    res.json(await webhooks.listEndpoints({ workspaceId: req.query.workspaceId as string | undefined }))
  })
}
`

const WORKER = `// Delivers queued webhook messages (sign, POST, retry with backoff, dead-letter).
// Reads platform.webhook_deliveries, populated as events match endpoint subscriptions.
import { createWebhooksWorker, pgAdapter } from "@obh/webhooks"
import type { WorkerContext } from "../context"

let worker: ReturnType<typeof createWebhooksWorker>

export function init(ctx: WorkerContext): void {
  worker = createWebhooksWorker({
    db: pgAdapter(ctx.pool),
    encryptionKey: process.env.WEBHOOK_SECRET_ENCRYPTION_KEY!,
    maxAttempts: 10,
  })
}

export async function tick(): Promise<void> {
  await worker.tick()
}
`
