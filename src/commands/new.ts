import path from "node:path"
import type { AppRecord, CapabilityName, ForgeManifest, PackageRecord, RecipeName } from "../types"
import { Plan } from "../project/plan"
import { ProjectContext } from "../project/context"
import { newManifest } from "../project/manifest"
import { FORGE_VERSION } from "../version"
import { getRecipe } from "../recipes"
import { getCapability, resolveOrder } from "../capabilities"
import { addLwdManifests } from "../generators/lwd"
import { askNew, type NewAnswers } from "../prompts"
import { log } from "../utils/logger"
import { flagsFrom, runPlan } from "./shared"

interface NewOptions {
  recipe?: string
  scope?: string
  topology?: string
  yes?: boolean
  dryRun?: boolean
  force?: boolean
}

/** `forge new app <name>` — scaffold a new project directory. */
export async function newCommand(kind: string, name: string | undefined, opts: NewOptions): Promise<void> {
  if (kind !== "app") {
    log.error(`\`forge new ${kind}\` is not supported in v1. Use \`forge new app <name>\`.`)
    process.exitCode = 1
    return
  }

  const answers = await resolveAnswers(name, opts)
  const recipe = getRecipe(answers.recipe)
  const shape = recipe.shape({ name: answers.name, scope: answers.scope, topology: answers.topology })

  // Primitives = recipe defaults + explicitly selected, expanded for prerequisites.
  const requested = [...new Set([...shape.autoPrimitives, ...answers.primitives])]
  const primitives = resolveOrder(requested)

  // Build the full intended manifest in memory (feeds lwd + written as forge.json).
  const manifest = buildManifest(answers, shape.apps, shape.packages, primitives)

  const plan = new Plan()
  recipe.generate(plan, { name: answers.name, scope: answers.scope, topology: answers.topology }, shape)
  plan.create("forge.json", JSON.stringify(manifest, null, 2) + "\n", "forge project manifest")

  // Apply capabilities against a synthetic context describing the new project.
  const ctx = new ProjectContext(
    ".",
    manifest,
    undefined,
    shape.apps.map((a) => a.name),
    shape.packages.map((p) => p.name),
  )
  for (const capName of primitives) {
    const cap = getCapability(capName)
    if (cap) cap.apply(ctx, plan)
  }

  addLwdManifests(plan, manifest)

  const root = path.resolve(process.cwd(), answers.name)
  log.info(`Scaffolding "${answers.name}" (${recipe.name}) into ${root}`)
  await runPlan(root, plan, flagsFrom(opts))

  if (!opts.dryRun) {
    log.success(`Done. Next: cd ${answers.name} && pnpm install`)
  }
}

async function resolveAnswers(name: string | undefined, opts: NewOptions): Promise<NewAnswers> {
  // Non-interactive when --yes and a name are given.
  if (opts.yes && name) {
    return {
      name,
      scope: opts.scope ?? `@${name}`,
      recipe: (opts.recipe as RecipeName) ?? "api-web-worker",
      topology: (opts.topology as "small" | "split") ?? "small",
      primitives: [],
    }
  }
  return askNew({
    name,
    scope: opts.scope,
    recipe: opts.recipe as RecipeName | undefined,
    topology: opts.topology as "small" | "split" | undefined,
  })
}

function buildManifest(
  answers: NewAnswers,
  apps: AppRecord[],
  packages: PackageRecord[],
  primitives: CapabilityName[],
): ForgeManifest {
  const createdAt = new Date().toISOString()
  const manifest = newManifest(answers.name, createdAt, answers.topology)
  manifest.forgeVersion = FORGE_VERSION
  for (const app of apps) manifest.apps[app.name] = app
  for (const pkg of packages) manifest.packages[pkg.name] = pkg
  for (const p of primitives) manifest.platform[p] = true
  return manifest
}
