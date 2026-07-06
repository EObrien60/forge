import type { Capability } from "./types"
import { addPlatformPackage, migrationModule } from "./helpers"

export const jobs: Capability = {
  name: "jobs",
  describe: "Postgres job queue + worker (background/scheduled commands)",
  apply(ctx, plan) {
    addPlatformPackage(plan, ctx, "jobs", { api: true, worker: true })
    plan.create("scripts/migrations.d/jobs.ts", migrationModule("jobs"), "jobs migrations wiring")

    if (ctx.hasApp("api")) {
      plan.create("apps/api/src/platform/jobs.ts", JOBS_API, "jobs registry + client")
    }
    if (ctx.hasWorker()) {
      plan.create("apps/worker/src/consumers.d/jobs.ts", JOBS_WORKER, "jobs worker tick")
    }

    plan.patchManifest({ platform: { jobs: true } })
    plan.nextStep("Run `pnpm migrate`, then enqueue `send_report` from a route and handle it in the worker.")
  },
}

const JOBS_API = `// Adjust to the @obh/jobs version you install.
import { createJobClient, createJobRegistry, defineJob, pgAdapter } from "@obh/jobs"
import { pool } from "../db"

export const sendReport = defineJob({ command: "send_report" })

export const registry = createJobRegistry()
registry.register(sendReport)

export const jobs = createJobClient({ db: pgAdapter(pool), registry })
`

const JOBS_WORKER = `// Claims and runs jobs. Handlers must be idempotent (at-least-once delivery).
import { createWorker, pgAdapter } from "@obh/jobs"
import type { WorkerContext } from "../context"

let worker: ReturnType<typeof createWorker>

export function init(ctx: WorkerContext): void {
  worker = createWorker({
    db: pgAdapter(ctx.pool),
    handlers: {
      send_report: async () => {
        // TODO: generate and deliver the report.
      },
    },
    batchSize: 20,
    maxConcurrency: 5,
    maxAttempts: 10,
  })
}

export async function tick(): Promise<void> {
  await worker.tick()
}
`
