import type { Capability } from "./types"
import { addPlatformPackage, apiFramework, hasNotesExample, migrationModule } from "./helpers"

export const analytics: Capability = {
  name: "analytics",
  requires: ["events"],
  describe: "Event-derived KPIs — facts rolled into queryable timeseries",
  apply(ctx, plan) {
    addPlatformPackage(plan, ctx, "analytics", { api: true, worker: true })
    plan.create("scripts/migrations.d/analytics.ts", migrationModule("analytics"), "analytics migrations wiring")

    const notes = hasNotesExample(ctx)
    if (ctx.hasApp("api")) {
      plan.create("apps/api/src/platform/analytics.ts", apiClient(notes), "analytics client + metrics")
      plan.create(
        "apps/api/src/routes/analytics.ts",
        apiFramework(ctx) === "hono" ? ROUTE_HONO : ROUTE_EXPRESS,
        "metric timeseries route",
      )
    }
    if (ctx.hasWorker()) {
      plan.create("apps/worker/src/analytics-metrics.ts", workerMetrics(notes), "worker-side metric definitions")
      plan.create(
        "apps/worker/src/dispatch.d/analytics.ts",
        `export const consumer = { name: "analytics", events: ["*"] }\n`,
        "register analytics as an event consumer",
      )
      plan.create("apps/worker/src/consumers.d/analytics.ts", WORKER, "analytics rollup tick")
    }

    plan.patchManifest({ platform: { analytics: true } })
    plan.nextStep("Run `pnpm migrate`. Query metrics at GET /api/analytics/:metric.")
  },
}

function metricDefs(notes: boolean): string {
  return notes
    ? `  defineMetric({ key: "notes_created", events: "note.created", aggregation: "count" }),`
    : `  // defineMetric({ key: "things_created", events: "thing.created", aggregation: "count" }),`
}

function apiClient(notes: boolean): string {
  return `import { createAnalyticsClient, defineMetric, pgAdapter, type MetricDefinition } from "@obh/analytics"
import { pool } from "../db"

export const metrics: MetricDefinition[] = [
${metricDefs(notes)}
]

export const analytics = createAnalyticsClient({ db: pgAdapter(pool), metrics })
`
}

function workerMetrics(notes: boolean): string {
  return `import { defineMetric, type MetricDefinition } from "@obh/analytics"

// Worker-side copy of the metric definitions (kept here so the worker never
// imports across app boundaries). Mirror of apps/api/src/platform/analytics.ts.
export const metrics: MetricDefinition[] = [
${metricDefs(notes)}
]
`
}

const ROUTE_HONO = `import type { Hono } from "hono"
import type { Bucket } from "@obh/analytics"
import { analytics } from "../platform/analytics"
import { WORKSPACE } from "../platform/events"

export function register(app: Hono): void {
  app.get("/api/analytics/:metric", async (c) => {
    const bucket = (c.req.query("bucket") as Bucket) ?? "day"
    return c.json(await analytics.timeseries({ workspaceId: WORKSPACE, metric: c.req.param("metric"), bucket }))
  })
}
`

const ROUTE_EXPRESS = `import type { Express, Request, Response } from "express"
import type { Bucket } from "@obh/analytics"
import { analytics } from "../platform/analytics"
import { WORKSPACE } from "../platform/events"

export function register(app: Express): void {
  app.get("/api/analytics/:metric", async (req: Request, res: Response) => {
    const bucket = (req.query.bucket as Bucket) ?? "day"
    res.json(await analytics.timeseries({ workspaceId: WORKSPACE, metric: req.params.metric, bucket }))
  })
}
`

const WORKER = `// Claims the "analytics" deliveries and rolls facts into metric buckets.
import { createAnalyticsWorker, pgAdapter } from "@obh/analytics"
import { metrics } from "../analytics-metrics"
import type { WorkerContext } from "../context"

let worker: ReturnType<typeof createAnalyticsWorker>

export function init(ctx: WorkerContext): void {
  worker = createAnalyticsWorker({ db: pgAdapter(ctx.pool), metrics, instanceId: "worker" })
}

export async function tick(): Promise<void> {
  await worker.tick()
}
`
