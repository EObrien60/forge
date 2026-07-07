import path from "node:path"
import type { ApiFramework, AppRecord, CapabilityName, ExampleDomain, ForgeManifest, PackageRecord, RecipeName } from "../types"
import { Plan } from "../project/plan"
import { ProjectContext } from "../project/context"
import { newManifest } from "../project/manifest"
import { getRecipe, type RecipeInput } from "../recipes"
import { getCapability, resolveOrder } from "../capabilities"
import { addLwdManifests } from "../generators/lwd"
import { detectGitRepo } from "../utils/git"
import { askNew, askRepo, type NewAnswers } from "../prompts"
import { log } from "../utils/logger"
import { flagsFrom, runPlan } from "./shared"

interface NewOptions {
  recipe?: string
  scope?: string
  topology?: string
  apiFramework?: string
  example?: boolean
  sdk?: boolean
  repo?: string
  yes?: boolean
  dryRun?: boolean
  force?: boolean
}

/** `forge new app <name>` — scaffold a new project directory. */
export async function newCommand(kind: string, name: string | undefined, opts: NewOptions): Promise<void> {
  if (kind !== "app") {
    log.error(`\`forge new ${kind}\` is not supported yet. Use \`forge new app <name>\`.`)
    process.exitCode = 1
    return
  }

  const answers = await resolveAnswers(name, opts)
  const repo = await resolveRepo(opts, answers.name)

  const recipe = getRecipe(answers.recipe)
  const input: RecipeInput = {
    name: answers.name,
    scope: answers.scope,
    topology: answers.topology,
    apiFramework: answers.apiFramework,
    example: answers.example,
    sdk: answers.sdk,
  }
  const shape = recipe.shape(input)

  const requested = [...new Set([...shape.autoPrimitives, ...answers.primitives])]
  const primitives = resolveOrder(requested)

  const manifest = buildManifest(answers, repo, shape.apps, shape.packages, primitives)

  const plan = new Plan()
  recipe.generate(plan, input, shape)
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
  log.info(`Scaffolding "${answers.name}" (${recipe.name}, ${answers.apiFramework}${answers.example ? ", notes example" : ""}) into ${root}`)
  await runPlan(root, plan, flagsFrom(opts))

  if (!opts.dryRun) {
    log.success(`Done. Next: cd ${answers.name} && pnpm install && pnpm migrate`)
  }
}

async function resolveAnswers(name: string | undefined, opts: NewOptions): Promise<NewAnswers> {
  const apiFramework = opts.apiFramework as ApiFramework | undefined
  const forcedExample: ExampleDomain | undefined = opts.example === false ? null : undefined
  const sdk = opts.sdk !== false

  if (opts.yes && name) {
    return {
      name,
      scope: opts.scope ?? `@${name}`,
      recipe: (opts.recipe as RecipeName) ?? "api-web-worker",
      topology: (opts.topology as "small" | "split") ?? "small",
      apiFramework: apiFramework ?? "hono",
      example: opts.example === false ? null : "notes",
      sdk,
      primitives: [],
    }
  }

  return askNew({
    name,
    scope: opts.scope,
    recipe: opts.recipe as RecipeName | undefined,
    topology: opts.topology as "small" | "split" | undefined,
    apiFramework,
    example: forcedExample,
    sdk,
  })
}

/** Resolve the deploy repo: --repo flag, else git remote, else prompt (unless --yes). */
async function resolveRepo(opts: NewOptions, name: string): Promise<string | undefined> {
  if (opts.repo) return opts.repo
  const detected = await detectGitRepo(process.cwd())
  if (detected) {
    log.info(`Detected git remote: ${detected.slug}`)
    return detected.slug
  }
  if (opts.yes) return undefined
  const answer = await askRepo(`your-org/${name}`)
  return answer || undefined
}

function buildManifest(
  answers: NewAnswers,
  repo: string | undefined,
  apps: AppRecord[],
  packages: PackageRecord[],
  primitives: CapabilityName[],
): ForgeManifest {
  const manifest = newManifest(answers.name, new Date().toISOString(), {
    topology: answers.topology,
    apiFramework: answers.apiFramework,
    sdk: answers.sdk,
    example: answers.example,
    repo,
  })
  for (const app of apps) manifest.apps[app.name] = app
  for (const pkg of packages) manifest.packages[pkg.name] = pkg
  for (const p of primitives) manifest.platform[p] = true
  return manifest
}
