import type { Capability } from "./types"
import { addPlatformPackage, apiFramework, hasNotesExample, migrationModule } from "./helpers"

export const settings: Capability = {
  name: "settings",
  describe: "Typed, scoped configuration — defaults in code, overrides per workspace in Postgres",
  apply(ctx, plan) {
    addPlatformPackage(plan, ctx, "settings", { api: true })
    // defineSetting validates values with a zod schema.
    if (ctx.hasApp("api")) plan.addDependency("apps/api", "zod", "^3.23.8")
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
  const def = notes
    ? `export const notesRetentionDays = defineSetting({
  key: "notes.retention_days",
  schema: z.number().int().positive(),
  defaultValue: 30,
  scopes: ["platform", "workspace"],
})`
    : `export const exampleFlag = defineSetting({
  key: "app.example_flag",
  schema: z.boolean(),
  defaultValue: false,
  scopes: ["platform", "workspace"],
})`
  const exportName = notes ? "notesRetentionDays" : "exampleFlag"
  return `import { createSettingsClient, createSettingsRegistry, defineSetting, pgAdapter } from "@obh/settings"
import { z } from "zod"
import { pool } from "../db"

// Every platform row is scoped to a workspace. Single-tenant apps can leave this.
export const WORKSPACE = process.env.WORKSPACE_ID ?? "default"

// A typed setting: schema + default in code, overridable per scope (most specific
// wins: user > group > workspace > platform > default).
${def}

export const registry = createSettingsRegistry([${exportName}])

// The client is stateless; each call takes a db/tx handle and a resolution context.
export const settings = createSettingsClient({ registry })
export const settingsDb = pgAdapter(pool)
`
}

const ROUTE_HONO = `import type { Hono } from "hono"
import { settings, settingsDb, WORKSPACE } from "../platform/settings"

export function register(app: Hono): void {
  // Resolve a setting's effective value for the current workspace, falling back
  // through platform default to the definition default.
  app.get("/settings/:key", async (c) => {
    return c.json(await settings.resolve(settingsDb, c.req.param("key"), { workspaceId: WORKSPACE }))
  })
}
`

const ROUTE_EXPRESS = `import type { Express, Request, Response } from "express"
import { settings, settingsDb, WORKSPACE } from "../platform/settings"

export function register(app: Express): void {
  app.get("/settings/:key", async (req: Request, res: Response) => {
    res.json(await settings.resolve(settingsDb, req.params.key, { workspaceId: WORKSPACE }))
  })
}
`
