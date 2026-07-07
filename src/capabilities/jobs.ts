import type { Capability } from "./types"
import { addPlatformPackage, hasNotesExample, migrationModule } from "./helpers"

export const jobs: Capability = {
  name: "jobs",
  describe: "Postgres job queue + worker — background/scheduled commands, idempotent handlers",
  apply(ctx, plan) {
    addPlatformPackage(plan, ctx, "jobs", { api: true, worker: true })
    // defineJob validates payloads with a zod schema on both the enqueue and run sides.
    if (ctx.hasApp("api")) plan.addDependency("apps/api", "zod", "^3.23.8")
    if (ctx.hasWorker()) plan.addDependency("apps/worker", "zod", "^3.23.8")
    plan.create("scripts/migrations.d/jobs.ts", migrationModule("jobs"), "jobs migrations wiring")

    const notes = hasNotesExample(ctx)
    if (ctx.hasApp("api")) {
      plan.create("apps/api/src/platform/jobs.ts", apiClient(notes), "jobs client + registry")
      if (notes) {
        // Enqueue a job whenever a note is created — inside the write transaction.
        plan.create("apps/api/src/bus.d/jobs-index.ts", ENQUEUE, "enqueue a job on note.created")
      }
    }
    if (ctx.hasWorker()) {
      plan.create("apps/worker/src/consumers.d/jobs.ts", worker(notes), "jobs worker (claims + runs jobs)")
    }

    plan.patchManifest({ platform: { jobs: true } })
    plan.nextStep("Run `pnpm migrate`. Enqueue with jobs.enqueue(tx, { name, workspaceId, payload }); the worker runs handlers.")
  },
}

interface JobExample {
  name: string
  export: string
  schema: string
  field: string
}

function jobExample(notes: boolean): JobExample {
  return notes
    ? { name: "send_welcome_email", export: "sendWelcomeEmail", schema: "z.object({ noteId: z.string() })", field: "note_id: payload.noteId" }
    : { name: "example_job", export: "exampleJob", schema: "z.object({ id: z.string() })", field: "id: payload.id" }
}

function apiClient(notes: boolean): string {
  const d = jobExample(notes)
  return `import { createJobClient, createJobRegistry, defineJob, type JobDb, type JobDefinition } from "@obh/jobs"
import { z } from "zod"

// Every platform row is scoped to a workspace. Single-tenant apps can leave this.
export const WORKSPACE = process.env.WORKSPACE_ID ?? "default"

// Jobs are commands (snake_case imperatives), not events. The handler runs in the
// worker (apps/worker/src/consumers.d/jobs.ts); here the schema validates payloads
// at enqueue time. Keep the name + schema in sync with the worker's copy.
export const ${d.export} = defineJob({
  name: "${d.name}",
  version: 1,
  schema: ${d.schema},
  handler: async () => {
    throw new Error("${d.name} runs in the worker, not the API")
  },
})

export const registry = createJobRegistry([${d.export} as JobDefinition])

export const jobs = createJobClient({ source: "app", registry })

/** Adapt a raw pg transaction to the structural JobDb @obh/jobs expects. */
export function asJobDb(tx: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }): JobDb {
  return { query: (sql: string, params?: unknown[]) => tx.query(sql, params) as never }
}
`
}

const ENQUEUE = `import { onEmit } from "../bus"
import { asJobDb, jobs, sendWelcomeEmail, WORKSPACE } from "../platform/jobs"

// Enqueue a job on the SAME transaction as the note write, so the job is durable
// exactly when the note is (and never queued if the write rolls back). The
// idempotency key makes a re-emit a no-op rather than a duplicate job.
onEmit(async (tx, name, payload) => {
  if (name !== "note.created") return
  const noteId = String((payload as { id?: string }).id ?? "")
  await jobs.enqueue(asJobDb(tx), {
    name: sendWelcomeEmail.name,
    workspaceId: WORKSPACE,
    payload: { noteId },
    idempotencyKey: \`welcome:\${noteId}\`,
  })
})
`

function worker(notes: boolean): string {
  const d = jobExample(notes)
  return `// Runs queued jobs: each tick claims a batch and executes the matching handler.
// Handlers live here so the worker never imports across app boundaries; keep the
// name + schema in sync with apps/api/src/platform/jobs.ts.
import { createJobRegistry, createWorker, defineJob, pgAdapter, type JobDefinition } from "@obh/jobs"
import { z } from "zod"
import type { WorkerContext } from "../context"

const ${d.export} = defineJob({
  name: "${d.name}",
  version: 1,
  schema: ${d.schema},
  handler: async (ctx, payload) => {
    ctx.log.info("running ${d.name}", { ${d.field} })
    // Real work goes here (call your mailer, render a PDF, …). Handlers must be
    // idempotent: at-least-once execution means a job can run more than once.
    console.log(JSON.stringify({ msg: "${d.name} done", ${d.field}, job_id: ctx.jobId }))
  },
})

const registry = createJobRegistry([${d.export} as JobDefinition])

let worker: ReturnType<typeof createWorker>

export function init(ctx: WorkerContext): void {
  worker = createWorker({ db: pgAdapter(ctx.pool), registry, instanceId: "worker" })
}

export async function tick(): Promise<void> {
  await worker.tick()
}
`
}
