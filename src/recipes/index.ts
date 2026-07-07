import type { ApiFramework, AppRecord, CapabilityName, ExampleDomain, PackageRecord, RecipeName, Topology } from "../types"
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
  apiFramework: ApiFramework
  example: ExampleDomain
  sdk: boolean
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

const workerApp: AppRecord = { name: "worker", path: "apps/worker", role: "worker" }
const sdkPkg: PackageRecord = { name: "sdk", path: "packages/sdk" }

function apiApp(input: RecipeInput): AppRecord {
  return { name: "api", path: "apps/api", framework: input.apiFramework, role: "api" }
}
const adminApp: AppRecord = { name: "admin", path: "apps/admin", framework: "vite-react", role: "web" }

function generateApps(plan: Plan, input: RecipeInput, shape: RecipeShape): void {
  addProjectSkeleton(plan, { name: input.name, topology: input.topology })
  for (const app of shape.apps) {
    if (app.role === "api") addApiApp(plan, { scope: input.scope, framework: input.apiFramework, example: input.example })
    else if (app.role === "web") addWebApp(plan, { scope: input.scope, name: app.name, example: input.example })
    else if (app.role === "worker") addWorkerApp(plan, { scope: input.scope })
  }
  if (shape.packages.some((p) => p.name === "sdk")) addSdkPackage(plan, { scope: input.scope, example: input.example })
}

/** Drop the SDK package from a shape when the project opts out of it. */
function withSdk(input: RecipeInput, packages: PackageRecord[]): PackageRecord[] {
  return input.sdk ? packages : packages.filter((p) => p.name !== "sdk")
}

export const RECIPES: Record<RecipeName, Recipe> = {
  "api-web-worker": {
    name: "api-web-worker",
    describe: "API + admin frontend + worker + shared SDK",
    shape: (input) => ({ apps: [apiApp(input), adminApp, workerApp], packages: withSdk(input, [sdkPkg]), autoPrimitives: [] }),
    generate: generateApps,
  },
  "full-saas": {
    name: "full-saas",
    describe: "api-web-worker plus recommended primitives (events, jobs, files, audit)",
    shape: (input) => ({
      apps: [apiApp(input), adminApp, workerApp],
      packages: withSdk(input, [sdkPkg]),
      autoPrimitives: ["events", "jobs", "files", "audit"],
    }),
    generate: generateApps,
  },
  "api-only": {
    name: "api-only",
    describe: "Backend API + shared SDK",
    shape: (input) => ({ apps: [apiApp(input)], packages: withSdk(input, [sdkPkg]), autoPrimitives: [] }),
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
    describe: "OBH primitive-style package — use `forge new package <name>`",
    shape: () => ({ apps: [], packages: [], autoPrimitives: [] }),
    generate: () => {
      throw new Error("Platform packages are scaffolded with `forge new package <name>`, not a recipe.")
    },
  },
}

export function getRecipe(name: RecipeName): Recipe {
  const r = RECIPES[name]
  if (!r) throw new Error(`Unknown recipe: ${name}`)
  return r
}
