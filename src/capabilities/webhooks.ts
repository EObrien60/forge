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
      plan.create(
        "apps/api/src/routes/webhooks.ts",
        apiFramework(ctx) === "hono" ? ROUTE_HONO : ROUTE_EXPRESS,
        "manage webhook endpoints",
      )
    }
    if (ctx.hasWorker()) {
      plan.create(
        "apps/worker/src/dispatch.d/webhooks.ts",
        `export const consumer = { name: "webhooks", events: ["*"] }\n`,
        "register webhooks as an event consumer",
      )
      plan.create("apps/worker/src/consumers.d/webhooks.ts", WORKER, "webhook ingest + delivery tick")
    }

    plan.addEnvVar({
      name: "WEBHOOK_SECRET_ENCRYPTION_KEY",
      example: "change-me-32-bytes-min",
      comment: "encrypts per-endpoint signing secrets at rest",
      secret: true,
    })

    plan.patchManifest({ platform: { webhooks: true } })
    plan.nextStep("Run `pnpm migrate` and set WEBHOOK_SECRET_ENCRYPTION_KEY. Events fan out to endpoint deliveries, sent by the worker.")
  },
}

// The client's endpoint methods each take a db handle as their first argument,
// so the platform module exports the adapter alongside the client.
const CLIENT = `import { createWebhooksClient, pgAdapter } from "@obh/webhooks"
import { pool } from "../db"

export const webhooksDb = pgAdapter(pool)

// secretEncryptionKey encrypts each endpoint's signing secret at rest.
export const webhooks = createWebhooksClient({
  secretEncryptionKey: process.env.WEBHOOK_SECRET_ENCRYPTION_KEY,
})
`

const ROUTE_HONO = `import type { Hono } from "hono"
import { webhooks, webhooksDb } from "../platform/webhooks"
import { WORKSPACE } from "../platform/events"

export function register(app: Hono): void {
  // Register an endpoint. The plaintext signing secret is returned once, here.
  app.post("/api/webhooks/endpoints", async (c) => {
    const body = await c.req.json<{ name: string; url: string; eventPatterns: string[] }>()
    const result = await webhooks.createEndpoint(webhooksDb, {
      workspaceId: WORKSPACE,
      name: body.name,
      url: body.url,
      eventPatterns: body.eventPatterns,
    })
    return c.json(result, 201)
  })

  app.get("/api/webhooks/endpoints", async (c) => {
    return c.json(await webhooks.listEndpoints(webhooksDb, { workspaceId: WORKSPACE }))
  })
}
`

const ROUTE_EXPRESS = `import type { Express, Request, Response } from "express"
import { webhooks, webhooksDb } from "../platform/webhooks"
import { WORKSPACE } from "../platform/events"

export function register(app: Express): void {
  app.post("/api/webhooks/endpoints", async (req: Request, res: Response) => {
    const result = await webhooks.createEndpoint(webhooksDb, {
      workspaceId: WORKSPACE,
      name: req.body.name,
      url: req.body.url,
      eventPatterns: req.body.eventPatterns,
    })
    res.status(201).json(result)
  })

  app.get("/api/webhooks/endpoints", async (_req: Request, res: Response) => {
    res.json(await webhooks.listEndpoints(webhooksDb, { workspaceId: WORKSPACE }))
  })
}
`

const WORKER = `// Two phases per tick: (1) claim the "webhooks" event deliveries and ingest each
// event into per-endpoint webhook deliveries; (2) deliver pending webhook rows
// (sign, POST, retry with backoff, auto-disable dead endpoints).
import { createConsumerRunner, pgAdapter as eventsPgAdapter } from "@obh/events"
import { createWebhooksClient, createWebhooksWorker, defineWebhookConsumer, pgAdapter } from "@obh/webhooks"
import type { WorkerContext } from "../context"

let runner: ReturnType<typeof createConsumerRunner>
let delivery: ReturnType<typeof createWebhooksWorker>

export function init(ctx: WorkerContext): void {
  const client = createWebhooksClient({
    secretEncryptionKey: process.env.WEBHOOK_SECRET_ENCRYPTION_KEY,
  })
  // The consumer's handler calls client.ingestEvent to fan an event out to
  // matching endpoints (creating deliveries the delivery worker then sends).
  runner = createConsumerRunner({
    db: eventsPgAdapter(ctx.pool),
    consumers: [defineWebhookConsumer({ client, db: pgAdapter(ctx.pool), name: "webhooks" })],
    instanceId: "worker",
  })
  delivery = createWebhooksWorker({
    db: pgAdapter(ctx.pool),
    instanceId: "worker",
    secretEncryptionKey: process.env.WEBHOOK_SECRET_ENCRYPTION_KEY,
  })
}

export async function tick(): Promise<void> {
  await runner.tick()
  await delivery.tick()
}
`
