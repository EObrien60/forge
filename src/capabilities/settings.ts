import type { Capability } from "./types"
import { addPlatformPackage, apiFramework, hasNotesExample, migrationModule } from "./helpers"

export const settings: Capability = {
  name: "settings",
  describe: "Typed, scoped configuration — defaults in code, overrides per workspace in Postgres",
  apply(ctx, plan) {
    addPlatformPackage(plan, ctx, "settings", { api: true })
    plan.create("scripts/migrations.d/settings.ts", migrationModule("settings"), "settings migrations wiring")

    if (ctx.hasApp("api")) {
      plan.create("apps/api/src/platform/settings.ts", registryFile(hasNotesExample(ctx)), "settings registry + client")
      plan.create("apps/api/src/routes/settings.ts", apiFramework(ctx) === "hono" ? ROUTE_HONO : ROUTE_EXPRESS, "read a resolved setting")
    }

    plan.patchManifest({ platform: { settings: true } })
    plan.nextStep("Run `pnpm migrate`. Defaults live in code; overrides resolve per scope from platform.settings.")
  },
}

function registryFile(notes: boolean): string {
  const defs = notes
    ? `// A typed setting: a default in code, overridable per scope (e.g. workspace).
export const notesRetentionDays = defineSetting({
  key: "notes.retention_days",
  type: "number",
  default: 30,
})

const registry = createSettingsRegistry()
registry.register(notesRetentionDays)`
    : `const registry = createSettingsRegistry()`
  return `// Adjust to the @obh/settings version you install.
import { createSettingsClient, createSettingsRegistry, defineSetting, pgAdapter } from "@obh/settings"
import { pool } from "../db"

${defs}

export { registry }
export const settings = createSettingsClient({ db: pgAdapter(pool), registry })
`
}

const ROUTE_HONO = `import type { Hono } from "hono"
import { settings } from "../platform/settings"

export function register(app: Hono): void {
  // Resolve a setting for a scope: ?scope=workspace:<id>, falling back to the default.
  app.get("/settings/:key", async (c) => {
    const scope = c.req.query("scope")
    return c.json({ value: await settings.get(c.req.param("key"), { scope }) })
  })
}
`

const ROUTE_EXPRESS = `import type { Express, Request, Response } from "express"
import { settings } from "../platform/settings"

export function register(app: Express): void {
  app.get("/settings/:key", async (req: Request, res: Response) => {
    res.json({ value: await settings.get(req.params.key, { scope: req.query.scope as string | undefined }) })
  })
}
`
