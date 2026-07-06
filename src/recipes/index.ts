import type { AppRecord, CapabilityName, PackageRecord, RecipeName, Topology } from "../types"
import type { Plan } from "../project/plan"
import { addProjectSkeleton } from "../generators/root"
import { addApiApp } from "../generators/api"
import { addWebApp } from "../generators/web"
import { addWorkerApp } from "../generators/worker"
import { addSdkPackage } from "../generators/sdk"

export interface RecipeInput {
  name: string
  scope: string
  topology: Topology
}

export interface RecipeShape {
  apps: AppRecord[]
  packages: PackageRecord[]
  /** Primitives the recipe installs automatically (still opt-out-able). */
  autoPrimitives: CapabilityName[]
}

export interface Recipe {
  name: RecipeName
  describe: string
  shape(input: RecipeInput): RecipeShape
  generate(plan: Plan, input: RecipeInput, shape: RecipeShape): void
}

const apiApp: AppRecord = { name: "api", path: "apps/api", framework: "hono", role: "api" }
const adminApp: AppRecord = { name: "admin", path: "apps/admin", framework: "vite-react", role: "web" }
const workerApp: AppRecord = { name: "worker", path: "apps/worker", role: "worker" }
const sdkPkg: PackageRecord = { name: "sdk", path: "packages/sdk" }

function generateApps(plan: Plan, input: RecipeInput, shape: RecipeShape): void {
  addProjectSkeleton(plan, { name: input.name, topology: input.topology })
  for (const app of shape.apps) {
    if (app.role === "api") addApiApp(plan, { scope: input.scope })
    else if (app.role === "web") addWebApp(plan, { scope: input.scope, name: app.name })
    else if (app.role === "worker") addWorkerApp(plan, { scope: input.scope })
  }
  if (shape.packages.some((p) => p.name === "sdk")) addSdkPackage(plan, { scope: input.scope })
}

export const RECIPES: Record<RecipeName, Recipe> = {
  "api-web-worker": {
    name: "api-web-worker",
    describe: "API + admin frontend + worker + shared SDK",
    shape: () => ({ apps: [apiApp, adminApp, workerApp], packages: [sdkPkg], autoPrimitives: [] }),
    generate: generateApps,
  },
  "full-saas": {
    name: "full-saas",
    describe: "api-web-worker plus recommended primitives (events, jobs, files, audit)",
    shape: () => ({
      apps: [apiApp, adminApp, workerApp],
      packages: [sdkPkg],
      autoPrimitives: ["events", "jobs", "files", "audit"],
    }),
    generate: generateApps,
  },
  "api-only": {
    name: "api-only",
    describe: "Backend API + shared SDK",
    shape: () => ({ apps: [apiApp], packages: [sdkPkg], autoPrimitives: [] }),
    generate: generateApps,
  },
  worker: {
    name: "worker",
    describe: "Background worker only",
    shape: () => ({ apps: [workerApp], packages: [], autoPrimitives: [] }),
    generate: generateApps,
  },
  "platform-package": {
    name: "platform-package",
    describe: "OBH primitive-style package (deferred in v1)",
    shape: () => ({ apps: [], packages: [], autoPrimitives: [] }),
    generate: () => {
      throw new Error("The platform-package recipe is not implemented in Forge v1.")
    },
  },
}

export function getRecipe(name: RecipeName): Recipe {
  const r = RECIPES[name]
  if (!r) throw new Error(`Unknown recipe: ${name}`)
  return r
}
