import path from "node:path"
import type { ApiFramework, AppRecord, CapabilityName, ExampleDomain, ForgeManifest, PackageRecord, RecipeName } from "../types"
import { Plan } from "../project/plan"
import { ProjectContext } from "../project/context"
import { newManifest } from "../project/manifest"
import { getRecipe, type RecipeInput } from "../recipes"
import { getCapability, resolveOrder } from "../capabilities"
import { addLwdManifests } from "../generators/lwd"
import { addMobileApp } from "../generators/mobile"
import { addPlatformPackageProject } from "../generators/platform-package"
import { detectGitRepo } from "../utils/git"
import { askNew, askRepo, confirm, type NewAnswers } from "../prompts"
import { log } from "../utils/logger"
import { flagsFrom, runPlan } from "./shared"

interface NewOptions {
  recipe?: string
  scope?: string
  topology?: string
  apiFramework?: string
  example?: boolean
  sdk?: boolean
  mobile?: string | boolean
  daemon?: boolean
  repo?: string
  yes?: boolean
  dryRun?: boolean
  force?: boolean
}

/** `forge new <app|package> [name]` — scaffold a new project directory. */
export async function newCommand(kind: string, name: string | undefined, opts: NewOptions): Promise<void> {
  if (kind === "package") return newPackageCommand(name, opts)
  if (kind !== "app") {
    log.error(`\`forge new ${kind}\` is not supported. Use \`forge new app <name>\` or \`forge new package <name>\`.`)
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

  const mobileApp: AppRecord | null = answers.mobile
    ? { name: answers.mobile, path: `apps/${answers.mobile}`, role: "mobile" }
    : null
  const allApps = mobileApp ? [...shape.apps, mobileApp] : shape.apps

  const manifest = buildManifest(answers, repo, allApps, shape.packages, primitives)

  const plan = new Plan()
  recipe.generate(plan, input, shape)
  if (mobileApp) addMobileApp(plan, { scope: answers.scope, name: mobileApp.name, example: answers.example })
  plan.create("forge.json", JSON.stringify(manifest, null, 2) + "\n", "forge project manifest")

  const ctx = new ProjectContext(
    ".",
    manifest,
    undefined,
    allApps.map((a) => a.name),
    shape.packages.map((p) => p.name),
  )
  for (const capName of primitives) {
    const cap = getCapability(capName)
    if (cap) cap.apply(ctx, plan)
  }

  addLwdManifests(plan, manifest)

  const root = path.resolve(process.cwd(), answers.name)
  const extras = [answers.apiFramework, answers.example ? "notes" : null, mobileApp ? "mobile" : null].filter(Boolean).join(", ")
  log.info(`Scaffolding "${answers.name}" (${recipe.name}, ${extras}) into ${root}`)
  await runPlan(root, plan, flagsFrom(opts))

  if (!opts.dryRun) {
    log.success(`Done. Next: cd ${answers.name} && pnpm install && pnpm migrate`)
  }
}

/** `forge new package <name>` — scaffold an OBH platform primitive repo. */
async function newPackageCommand(name: string | undefined, opts: NewOptions): Promise<void> {
  if (!name) {
    log.error("Usage: forge new package <name>")
    process.exitCode = 1
    return
  }
  const scope = opts.scope ?? "@obh"
  const daemon = opts.daemon !== undefined ? Boolean(opts.daemon) : opts.yes ? true : await confirm("Include an admin/worker daemon (apps/<name>d)?")

  const plan = new Plan()
  addPlatformPackageProject(plan, { name, scope, daemon })

  const manifest = newManifest(name, new Date().toISOString(), { topology: "small", sdk: false, example: null })
  manifest.packages[name] = { name, path: `packages/${name}` }
  if (daemon) manifest.apps[`${name}d`] = { name: `${name}d`, path: `apps/${name}d`, role: "worker" }
  plan.create("forge.json", JSON.stringify(manifest, null, 2) + "\n", "forge project manifest")

  const root = path.resolve(process.cwd(), name)
  log.info(`Scaffolding platform package "${scope}/${name}"${daemon ? " + daemon" : ""} into ${root}`)
  await runPlan(root, plan, flagsFrom(opts))
  if (!opts.dryRun) log.success(`Done. Next: cd ${name} && pnpm install && pnpm build`)
}

async function resolveAnswers(name: string | undefined, opts: NewOptions): Promise<NewAnswers> {
  const apiFramework = opts.apiFramework as ApiFramework | undefined
  const forcedExample: ExampleDomain | undefined = opts.example === false ? null : undefined
  const sdk = opts.sdk !== false
  const mobileFromFlag = opts.mobile === true ? "mobile" : typeof opts.mobile === "string" ? opts.mobile : undefined

  if (opts.yes && name) {
    return {
      name,
      scope: opts.scope ?? `@${name}`,
      recipe: (opts.recipe as RecipeName) ?? "api-web-worker",
      topology: (opts.topology as "small" | "split") ?? "small",
      apiFramework: apiFramework ?? "hono",
      example: opts.example === false ? null : "notes",
      sdk,
      mobile: mobileFromFlag ?? null,
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
    mobile: mobileFromFlag,
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
