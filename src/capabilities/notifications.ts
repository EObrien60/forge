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
      plan.create("apps/api/src/platform/notifications.ts", CLIENT, "direct-send notification client")
    }
    if (ctx.hasWorker()) {
      plan.create("apps/worker/src/notification-defs.ts", defsFile(notes), "worker-side templates + rules")
      plan.create(
        "apps/worker/src/dispatch.d/notifications.ts",
        `export const consumer = { name: "notifications", events: ["*"] }\n`,
        "register notifications as an event consumer",
      )
      plan.create("apps/worker/src/consumers.d/notifications.ts", WORKER, "notification intake + send tick")
    }

    plan.addEnvVar({
      name: "SMTP_URL",
      example: "smtp://user:pass@localhost:1025",
      comment: "smtp://user:pass@host:port (smtps:// for implicit TLS)",
    })

    plan.patchManifest({ platform: { notifications: true } })
    plan.nextStep("Run `pnpm migrate` and set SMTP_URL. Rules turn events into intents the worker renders and sends.")
  },
}

// The event-driven path (rules) is preferred; this client is the escape hatch
// for notifications that aren't domain events (invites, password resets).
const CLIENT = `import { createNotificationClient, pgAdapter } from "@obh/notifications"
import { pool } from "../db"

export const notifications = createNotificationClient({ db: pgAdapter(pool) })
`

function defsFile(notes: boolean): string {
  const templates = notes
    ? `  defineTemplate({
    key: "note_created_email",
    version: 1,
    channel: "email",
    name: "Note created",
    subject: "New note: {{title}}",
    bodyText: "A note titled {{title}} was just created.",
  }),`
    : `  // defineTemplate({ key: "thing_created_email", channel: "email", name: "Thing created", subject: "New thing", bodyText: "…" }),`
  const rules = notes
    ? `  defineNotificationRule({
    id: "rule_note_created",
    eventName: "note.created",
    templateKey: "note_created_email",
    recipientStrategy: "static_email",
    recipientConfig: { email: process.env.NOTIFY_TO ?? "ops@example.com" },
    variableMapping: { title: "$.payload.title" },
  }),`
    : `  // defineNotificationRule({ id: "rule_thing_created", eventName: "thing.created", templateKey: "thing_created_email", recipientStrategy: "static_email", recipientConfig: { email: "ops@example.com" } }),`
  return `import {
  defineNotificationRule,
  defineTemplate,
  type NotificationRule,
  type NotificationTemplate,
} from "@obh/notifications"

// Worker-side template + rule definitions, seeded into the DB on startup.
export const templates: NotificationTemplate[] = [
${templates}
]

export const rules: NotificationRule[] = [
${rules}
]
`
}

const WORKER = `// Seeds templates/rules, then each tick: claim the "notifications" event
// deliveries into intents, then render and send pending intents over SMTP
// (retried, dead-lettered). intake and send both run in the default tick().
import { createNotificationWorker, pgAdapter, smtpProvider, syncRules, syncTemplates } from "@obh/notifications"
import { rules, templates } from "../notification-defs"
import type { WorkerContext } from "../context"

let worker: ReturnType<typeof createNotificationWorker>

function providerFromEnv() {
  const url = new URL(process.env.SMTP_URL ?? "smtp://localhost:1025")
  return smtpProvider({
    host: url.hostname,
    port: Number(url.port) || 25,
    secure: url.protocol === "smtps:",
    user: url.username ? decodeURIComponent(url.username) : undefined,
    pass: url.password ? decodeURIComponent(url.password) : undefined,
    from: process.env.SMTP_FROM ?? "no-reply@example.com",
  })
}

export async function init(ctx: WorkerContext): Promise<void> {
  const db = pgAdapter(ctx.pool)
  // Keep the DB in sync with the code-authored templates/rules (idempotent).
  await syncTemplates(db, templates)
  await syncRules(db, rules)
  worker = createNotificationWorker({
    db,
    provider: providerFromEnv(),
    instanceId: "worker",
    defaultFrom: process.env.SMTP_FROM ?? "no-reply@example.com",
  })
}

export async function tick(): Promise<void> {
  await worker.tick()
}
`
