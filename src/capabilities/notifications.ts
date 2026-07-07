import type { Capability } from "./types"
import { addPlatformPackage, hasNotesExample, migrationModule } from "./helpers"

export const notifications: Capability = {
  name: "notifications",
  requires: ["events"],
  describe: "Email notification engine — templates + rules reacting to events, delivered over SMTP",
  apply(ctx, plan) {
    addPlatformPackage(plan, ctx, "notifications", { api: true, worker: true })
    plan.create("scripts/migrations.d/notifications.ts", migrationModule("notifications"), "notifications migrations wiring")

    const notes = hasNotesExample(ctx)
    if (ctx.hasApp("api")) {
      plan.create("apps/api/src/platform/notifications.ts", registryFile(notes), "templates + rules + client")
    }
    if (ctx.hasWorker()) {
      plan.create("apps/worker/src/consumers.d/notifications.ts", WORKER, "notification delivery tick")
    }

    plan.addEnvVar({ name: "SMTP_URL", example: "smtp://user:pass@localhost:1025", comment: "smtp://user:pass@host:port" })

    plan.patchManifest({ platform: { notifications: true } })
    plan.nextStep("Run `pnpm migrate` and set SMTP_URL. Rules turn events into queued emails the worker sends.")
  },
}

function registryFile(notes: boolean): string {
  const defs = notes
    ? `// A template plus a rule that fires it whenever a note is created.
export const noteCreatedEmail = defineTemplate({
  name: "note_created",
  subject: "New note: {{title}}",
  body: "A note titled {{title}} was just created.",
})

export const onNoteCreated = defineNotificationRule({
  event: "note.created",
  template: "note_created",
  to: (p: { authorEmail?: string }) => p.authorEmail,
})

const registry = createNotificationRegistry()
registry.register(noteCreatedEmail)
registry.register(onNoteCreated)`
    : `const registry = createNotificationRegistry()`
  return `// Adjust to the @obh/notifications version you install.
import { createNotificationClient, createNotificationRegistry, defineNotificationRule, defineTemplate, pgAdapter } from "@obh/notifications"
import { pool } from "../db"

${defs}

export { registry }
export const notifications = createNotificationClient({ db: pgAdapter(pool), registry })
`
}

const WORKER = `// Consumes events, materialises them into emails via the rules, and delivers
// over SMTP (retried, dead-lettered).
import { createNotificationWorker, createSmtpTransport, pgAdapter } from "@obh/notifications"
import { registry } from "../platform/notifications"
import type { WorkerContext } from "../context"

let worker: ReturnType<typeof createNotificationWorker>

export function init(ctx: WorkerContext): void {
  worker = createNotificationWorker({
    db: pgAdapter(ctx.pool),
    registry,
    transport: createSmtpTransport({ url: process.env.SMTP_URL! }),
  })
}

export async function tick(): Promise<void> {
  await worker.tick()
}
`
