import type { ApiFramework } from "../types"
import type { ProjectContext } from "../project/context"
import type { Plan } from "../project/plan"

const OBH_VERSION = "^0.1.0"

/** The API framework the project chose (defaults to hono). */
export function apiFramework(ctx: ProjectContext): ApiFramework {
  return ctx.manifest?.config?.apiFramework ?? "hono"
}

/** Whether the project was scaffolded with the notes example domain. */
export function hasNotesExample(ctx: ProjectContext): boolean {
  return ctx.manifest?.config?.example === "notes"
}

/** Map a capability's short name to its published @obh package name. */
export const OBH_PACKAGE: Record<string, string> = {
  events: "@obh/events",
  jobs: "@obh/jobs",
  files: "@obh/files",
  audit: "@obh/audit",
  settings: "@obh/settings",
  "api-keys": "@obh/api-keys",
  webhooks: "@obh/webhooks",
  "import-export": "@obh/import-export",
  entitlements: "@obh/entitlements",
  search: "@obh/search",
  analytics: "@obh/analytics",
  notifications: "@obh/notifications",
}

export interface PackageTargets {
  /** Add to apps/api (client/emit side). */
  api?: boolean
  /** Add to apps/worker (consumer side). */
  worker?: boolean
}

/**
 * Add an @obh platform package to the right package.json files. It is always
 * added to the root (so scripts/migrate.ts can resolve it) plus any requested
 * app that actually exists.
 */
export function addPlatformPackage(
  plan: Plan,
  ctx: ProjectContext,
  cap: string,
  targets: PackageTargets,
): void {
  const pkg = OBH_PACKAGE[cap]
  if (!pkg) return
  plan.addDependency(".", pkg, OBH_VERSION)
  if (targets.api && ctx.hasApp("api")) plan.addDependency("apps/api", pkg, OBH_VERSION)
  if (targets.worker && ctx.hasWorker()) plan.addDependency("apps/worker", pkg, OBH_VERSION)
}

/**
 * Standard migrations.d module. Every @obh package exports `pgAdapter` and
 * `runMigrations`, so the wiring is uniform.
 */
export function migrationModule(cap: string): string {
  const pkg = OBH_PACKAGE[cap]
  return `import { pgAdapter, runMigrations } from "${pkg}"
import type { Pool } from "pg"

// Registered automatically by scripts/migrate.ts. Creates this primitive's
// tables under the "platform" schema.
export async function migrate(pool: Pool): Promise<void> {
  await runMigrations(pgAdapter(pool))
}
`
}
