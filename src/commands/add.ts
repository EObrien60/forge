import type { CapabilityName } from "../types"
import { Plan } from "../project/plan"
import { ProjectContext } from "../project/context"
import { getCapability, isImplemented, missingPrerequisites, resolveOrder, CAPABILITIES } from "../capabilities"
import { addApiApp } from "../generators/api"
import { addWorkerApp } from "../generators/worker"
import { addSdkPackage } from "../generators/sdk"
import { addWebApp } from "../generators/web"
import { addMobileApp } from "../generators/mobile"
import { log } from "../utils/logger"
import { flagsFrom, runPlan } from "./shared"

const APP_KINDS = ["api", "web", "worker", "sdk", "mobile"] as const

/** `forge add <capability|api|web|worker|sdk> [name]` */
export async function addCommand(target: string, name: string | undefined, opts: Record<string, unknown>): Promise<void> {
  const ctx = await ProjectContext.load(process.cwd())
  if (!ctx.hasManifest()) {
    log.error("No forge.json found. Run inside a Forge project (or create one with `forge new app <name>`).")
    process.exitCode = 1
    return
  }

  const flags = flagsFrom(opts)
  const plan = new Plan()
  const scope = `@${ctx.requireManifest().name}`

  if ((APP_KINDS as readonly string[]).includes(target)) {
    addAppKind(ctx, plan, target, name, scope)
  } else if (isImplemented(target as CapabilityName)) {
    addCapabilityChain(ctx, plan, target as CapabilityName)
  } else {
    log.error(`Unknown target "${target}".`)
    log.plain("  apps:        api | web <name> | worker | sdk")
    log.plain("  primitives:  " + Object.keys(CAPABILITIES).join(" | "))
    process.exitCode = 1
    return
  }

  await runPlan(ctx.root, plan, flags)
}

function addAppKind(ctx: ProjectContext, plan: Plan, kind: string, name: string | undefined, scope: string): void {
  const config = ctx.requireManifest().config
  switch (kind) {
    case "api":
      addApiApp(plan, { scope, framework: config.apiFramework, example: config.example })
      plan.patchManifest({ apps: { api: { name: "api", path: "apps/api", framework: config.apiFramework, role: "api" } } })
      break
    case "worker":
      addWorkerApp(plan, { scope })
      plan.patchManifest({ apps: { worker: { name: "worker", path: "apps/worker", role: "worker" } } })
      break
    case "sdk":
      addSdkPackage(plan, { scope, example: config.example })
      plan.patchManifest({ packages: { sdk: { name: "sdk", path: "packages/sdk" } } })
      break
    case "web": {
      const appName = name ?? "admin"
      addWebApp(plan, { scope, name: appName, example: config.example })
      plan.patchManifest({
        apps: { [appName]: { name: appName, path: `apps/${appName}`, framework: "vite-react", role: "web" } },
      })
      break
    }
    case "mobile": {
      const appName = name ?? "mobile"
      addMobileApp(plan, { scope, name: appName, example: config.example })
      plan.patchManifest({ apps: { [appName]: { name: appName, path: `apps/${appName}`, role: "mobile" } } })
      break
    }
  }
  plan.nextStep("Regenerate deployment manifests if needed: forge generate lwd --force")
}

function addCapabilityChain(ctx: ProjectContext, plan: Plan, target: CapabilityName): void {
  const missing = missingPrerequisites(target, (n) => ctx.hasCapability(n))
  if (missing.length > 0) {
    log.info(`${target} requires ${missing.join(", ")} — adding ${missing.length > 1 ? "them" : "it"} too.`)
  }

  for (const capName of resolveOrder([target])) {
    if (ctx.hasCapability(capName) && capName !== target) continue
    const cap = getCapability(capName)
    if (cap) cap.apply(ctx, plan)
  }

  plan.nextStep("Run `pnpm migrate` to apply new platform migrations.")
  plan.nextStep("Refresh secrets in deployment manifests: forge generate lwd --force")
}
