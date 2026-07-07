import type { Capability } from "./types"
import { addPlatformPackage, hasNotesExample, migrationModule } from "./helpers"

export const jobs: Capability = {
  name: "jobs",
  describe: "Postgres job queue + worker — background/scheduled commands, idempotent handlers",
  apply(ctx, plan) {
    addPlatformPackage(plan, ctx, "jobs", { api: true, worker: true })
    plan.create("scripts/migrations.d/jobs.ts", migrationModule("jobs"), "jobs migrations wiring")

    const notes = hasNotesExample(ctx)
    if (ctx.hasApp("api")) {
      plan.create("apps/api/src/platform/jobs.ts", registryFile(notes), "jobs registry + client")
      if (notes) {
        // Enqueue a job whenever a note changes — inside the write transaction.
        plan.create("apps/api/src/bus.d/jobs-index.ts", INDEX_ON_WRITE, "enqueue index_note on note writes")
      }
    }
    if (ctx.hasWorker()) {
      plan.create("apps/worker/src/consumers.d/jobs.ts", worker(notes), "job worker tick")
    }

    plan.patchManifest({ platform: { jobs: true } })
    plan.nextStep("Run `pnpm migrate`. Jobs enqueue in-tx and run in the worker.")
  },
}

function registryFile(notes: boolean): string {
  const defs = notes
    ? `// Commands are snake_case. Facts (events) are dot.notation.
export const indexNote = defineJob({ command: "index_note" })

const registry = createJobRegistry()
registry.register(indexNote)`
    : `const registry = createJobRegistry()`
  return `// Adjust to the @obh/jobs version you install.
import { createJobClient, createJobRegistry, defineJob, pgAdapter } from "@obh/jobs"
import { pool } from "../db"

${defs}

export { registry }
export const jobs = createJobClient({ db: pgAdapter(pool), registry })
`
}

const INDEX_ON_WRITE = `import { onEmit } from "../bus"
import { indexNote, jobs } from "../platform/jobs"

// Enqueue on the same transaction as the note write, so the job is only queued
// if the write commits. Handlers must be idempotent (at-least-once delivery).
onEmit(async (tx, name, payload) => {
  if (name === "note.created" || name === "note.updated") {
    const note = payload as { id: string }
    await jobs.enqueue(tx, indexNote, { noteId: note.id })
  }
})
`

function worker(notes: boolean): string {
  const handler = notes
    ? `    index_note: async (args: { noteId: string }) => {
      // Real example: (re)build a projection / search doc for the note.
      console.log(JSON.stringify({ job: "index_note", noteId: args.noteId }))
    },`
    : `    // Register your job handlers here, e.g.:
    // send_report: async () => { /* ... */ },`
  return `import { createWorker, pgAdapter } from "@obh/jobs"
import type { WorkerContext } from "../context"

let worker: ReturnType<typeof createWorker>

export function init(ctx: WorkerContext): void {
  worker = createWorker({
    db: pgAdapter(ctx.pool),
    handlers: {
${handler}
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
}
