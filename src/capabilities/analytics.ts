import type { Capability } from "./types"
import { addPlatformPackage, apiFramework, hasNotesExample, migrationModule } from "./helpers"

export const analytics: Capability = {
  name: "analytics",
  requires: ["events"],
  describe: "Event-derived analytics — metrics defined in code, rolled up from the event stream",
  apply(ctx, plan) {
    addPlatformPackage(plan, ctx, "analytics", { api: true, worker: true })
    plan.create("scripts/migrations.d/analytics.ts", migrationModule("analytics"), "analytics migrations wiring")

    const notes = hasNotesExample(ctx)
    if (ctx.hasApp("api")) {
      plan.create("apps/api/src/platform/analytics.ts", registryFile(notes), "analytics client + metrics")
      plan.create("apps/api/src/routes/analytics.ts", apiFramework(ctx) === "hono" ? ROUTE_HONO : ROUTE_EXPRESS, "notes-created timeseries route")
    }
    if (ctx.hasWorker()) {
      plan.create("apps/worker/src/consumers.d/analytics.ts", WORKER, "analytics rollup tick")
    }

    plan.patchManifest({ platform: { analytics: true } })
    plan.nextStep("Run `pnpm migrate`. The worker rolls events into metrics; query them via /analytics.")
  },
}

function registryFile(notes: boolean): string {
  const defs = notes
    ? `// A counter metric incremented once per matching event.
export const notesCreated = defineMetric({
  name: "notes_created",
  event: "note.created",
  aggregate: "count",
})

const registry = createMetricRegistry()
registry.register(notesCreated)`
    : `const registry = createMetricRegistry()`
  return `// Adjust to the @obh/analytics version you install.
import { createAnalyticsClient, createMetricRegistry, defineMetric, pgAdapter } from "@obh/analytics"
import { pool } from "../db"

${defs}

export { registry }
export const analytics = createAnalyticsClient({ db: pgAdapter(pool), registry })
`
}

const ROUTE_HONO = `import type { Hono } from "hono"
import { analytics } from "../platform/analytics"

export function register(app: Hono): void {
  app.get("/analytics/notes-created", async (c) => {
    return c.json(await analytics.timeseries("notes_created", {
      interval: c.req.query("interval") ?? "day",
      workspaceId: c.req.query("workspaceId"),
    }))
  })
}
`

const ROUTE_EXPRESS = `import type { Express, Request, Response } from "express"
import { analytics } from "../platform/analytics"

export function register(app: Express): void {
  app.get("/analytics/notes-created", async (req: Request, res: Response) => {
    res.json(await analytics.timeseries("notes_created", {
      interval: (req.query.interval as string) ?? "day",
      workspaceId: req.query.workspaceId as string | undefined,
    }))
  })
}
`

const WORKER = `// Consumes events and rolls them into metric buckets (idempotent per event id).
import { createAnalyticsWorker, pgAdapter } from "@obh/analytics"
import { registry } from "../platform/analytics"
import type { WorkerContext } from "../context"

let worker: ReturnType<typeof createAnalyticsWorker>

export function init(ctx: WorkerContext): void {
  worker = createAnalyticsWorker({ db: pgAdapter(ctx.pool), registry })
}

export async function tick(): Promise<void> {
  await worker.tick()
}
`
