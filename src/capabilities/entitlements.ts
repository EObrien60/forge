import type { Capability } from "./types"
import { addPlatformPackage, apiFramework, hasNotesExample, migrationModule } from "./helpers"

export const entitlements: Capability = {
  name: "entitlements",
  describe: "Entitlements — feature access + numeric limits, enforced before the write",
  apply(ctx, plan) {
    addPlatformPackage(plan, ctx, "entitlements", { api: true })
    plan.create("scripts/migrations.d/entitlements.ts", migrationModule("entitlements"), "entitlements migrations wiring")

    if (ctx.hasApp("api")) {
      plan.create("apps/api/src/platform/entitlements.ts", registryFile(hasNotesExample(ctx)), "entitlements registry + client + guard")
      plan.create("apps/api/src/routes/entitlements.ts", apiFramework(ctx) === "hono" ? ROUTE_HONO : ROUTE_EXPRESS, "read a workspace's entitlements")
    }

    plan.patchManifest({ platform: { entitlements: true } })
    plan.nextStep("Run `pnpm migrate`. Call requireCanCreateNote(workspaceId) before creating a note.")
  },
}

function registryFile(notes: boolean): string {
  const defs = notes
    ? `// A numeric limit with a plan-wide default; override per workspace in Postgres.
export const maxNotes = defineEntitlement({
  key: "max_notes",
  type: "number",
  default: 100,
})

const registry = createEntitlementRegistry()
registry.register(maxNotes)`
    : `const registry = createEntitlementRegistry()`
  const guard = notes
    ? `
/** Throws (limit-exceeded) unless the workspace is under its max_notes limit. */
export async function requireCanCreateNote(workspaceId: string): Promise<void> {
  await entitlements.require("max_notes", {
    scope: { workspaceId },
    used: async () => {
      const { rows } = await pool.query<{ count: string }>("select count(*) from notes")
      return Number(rows[0].count)
    },
  })
}
`
    : ""
  return `// Adjust to the @obh/entitlements version you install.
import { createEntitlementRegistry, createEntitlementsClient, defineEntitlement, pgAdapter } from "@obh/entitlements"
import { pool } from "../db"

${defs}

export { registry }
export const entitlements = createEntitlementsClient({ db: pgAdapter(pool), registry })
${guard}`
}

const ROUTE_HONO = `import type { Hono } from "hono"
import { entitlements } from "../platform/entitlements"

export function register(app: Hono): void {
  app.get("/entitlements", async (c) => {
    return c.json(await entitlements.resolveAll({ workspaceId: c.req.query("workspaceId") }))
  })
}
`

const ROUTE_EXPRESS = `import type { Express, Request, Response } from "express"
import { entitlements } from "../platform/entitlements"

export function register(app: Express): void {
  app.get("/entitlements", async (req: Request, res: Response) => {
    res.json(await entitlements.resolveAll({ workspaceId: req.query.workspaceId as string | undefined }))
  })
}
`
