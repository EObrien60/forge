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
    plan.nextStep("Run `pnpm migrate`. Grant plans/overrides, then guard writes with entitlements.require(db, workspaceId, key).")
  },
}

function registryFile(notes: boolean): string {
  const def = notes
    ? `// A numeric limit with a code default; grant a higher value per plan or workspace.
export const notesMax = defineEntitlement({
  key: "notes.max",
  type: "number",
  defaultValue: 100,
})`
    : `// A boolean feature flag with a code default; grant true per plan or workspace.
export const exampleFeature = defineEntitlement({
  key: "app.example_feature",
  type: "boolean",
  defaultValue: false,
})`
  const exportName = notes ? "notesMax" : "exampleFeature"
  const guard = notes
    ? `
/** Throws unless the workspace is under its notes.max entitlement. */
export async function requireCanCreateNote(): Promise<void> {
  const max = await entitlements.limit(entitlementsDb, WORKSPACE, notesMax.key)
  const { rows } = await pool.query<{ count: string }>("select count(*)::int as count from notes")
  if (Number(rows[0].count) >= max) {
    throw new Error(\`workspace \${WORKSPACE} has reached its notes limit (\${max})\`)
  }
}
`
    : `
/** Throws EntitlementRequiredError unless the workspace has the feature. */
export async function requireExampleFeature(): Promise<void> {
  await entitlements.require(entitlementsDb, WORKSPACE, exampleFeature.key)
}
`
  return `import { createEntitlementRegistry, createEntitlementsClient, defineEntitlement, pgAdapter } from "@obh/entitlements"
import { pool } from "../db"

// Every platform row is scoped to a workspace. Single-tenant apps can leave this.
export const WORKSPACE = process.env.WORKSPACE_ID ?? "default"

${def}

export const registry = createEntitlementRegistry([${exportName}])

// The client is stateless; each call takes a db/tx handle and a workspace id.
export const entitlements = createEntitlementsClient({ registry })
export const entitlementsDb = pgAdapter(pool)
${guard}`
}

const ROUTE_HONO = `import type { Hono } from "hono"
import { entitlements, entitlementsDb, WORKSPACE } from "../platform/entitlements"

export function register(app: Hono): void {
  // All effective entitlements for the workspace (value + where it resolved from).
  app.get("/entitlements", async (c) => {
    return c.json(await entitlements.listEffective(entitlementsDb, WORKSPACE))
  })

  // Explain a single entitlement: effective value plus the full fallback chain.
  app.get("/entitlements/:key", async (c) => {
    return c.json(await entitlements.explain(entitlementsDb, WORKSPACE, c.req.param("key")))
  })
}
`

const ROUTE_EXPRESS = `import type { Express, Request, Response } from "express"
import { entitlements, entitlementsDb, WORKSPACE } from "../platform/entitlements"

export function register(app: Express): void {
  app.get("/entitlements", async (_req: Request, res: Response) => {
    res.json(await entitlements.listEffective(entitlementsDb, WORKSPACE))
  })

  app.get("/entitlements/:key", async (req: Request, res: Response) => {
    res.json(await entitlements.explain(entitlementsDb, WORKSPACE, req.params.key))
  })
}
`
