import path from "node:path"
import { randomBytes } from "node:crypto"
import type { StackManifest } from "./types"
import { resolveTemplate, templateRefs } from "./manifest"
import { readLwdToml, type LwdToml } from "./lwdtoml"
import type { LwdAdapter } from "./lwd"
import { log } from "../utils/logger"

export type SecretAction = "skip" | "generate" | "derive" | "blocked" | "manual-missing"

export interface SecretPlanItem {
  app: string
  key: string
  action: SecretAction
  /** Resolved value for generate/derive — NEVER logged. */
  value?: string
  reason?: string
}

export interface StackPlan {
  order: string[]
  items: SecretPlanItem[]
  /** Connectivity / derivation problems that block a clean deploy. */
  flags: string[]
}

export interface PlanOptions {
  rotate?: string[]
  onlyApp?: string
}

function genValue(type: "password" | "hex", bytes: number): string {
  const buf = randomBytes(bytes)
  return type === "hex" ? buf.toString("hex") : buf.toString("base64url")
}

/** Owner reaches a co-located service; a dedicated resource app is reachable cross-app; co-located [[services]] is not. */
function isReachable(serviceApp: string, consumer: string, manifest: StackManifest): boolean {
  if (consumer === serviceApp) return true
  return manifest.apps.find((a) => a.name === serviceApp)?.role === "resource"
}

/**
 * Pure planning: given the manifest, each app's lwd.toml, and the secret names
 * lwd already holds per app, decide what to skip / generate / derive / block.
 * No IO, no execution — this is what the tests exercise.
 */
export function planSecrets(
  manifest: StackManifest,
  tomlByApp: Record<string, LwdToml>,
  existingByApp: Record<string, string[]>,
  opts: PlanOptions = {},
): StackPlan {
  const rotate = new Set(opts.rotate ?? [])
  const items: SecretPlanItem[] = []
  const flags: string[] = []
  const runValues: Record<string, string> = {}
  const inScope = (app: string): boolean => !opts.onlyApp || app === opts.onlyApp

  // 1. Generated component secrets.
  for (const [name, g] of Object.entries(manifest.secrets.generate)) {
    const willRotate = rotate.has(name)
    let value: string | undefined
    const ensure = (): string => {
      if (!value) {
        value = genValue(g.type, g.bytes)
        runValues[name] = value
      }
      return value
    }
    for (const app of g.apps) {
      if (!inScope(app)) continue
      const has = (existingByApp[app] ?? []).includes(name)
      if (has && !willRotate) items.push({ app, key: name, action: "skip" })
      else items.push({ app, key: name, action: "generate", value: ensure() })
    }
  }

  // 2. Derived connection secrets.
  for (const [name, c] of Object.entries(manifest.secrets.connections)) {
    const consumers = [...c.apps, ...(c.sharedWith ?? [])]
    const refs = templateRefs(c.template)
    const rotatedRef = refs.some((r) => rotate.has(r))
    for (const app of consumers) {
      if (!inScope(app)) continue
      if (!isReachable(c.service.app, app, manifest)) {
        const msg = `${app} can't reach "${c.service.name}" co-located in ${c.service.app}: move it to a dedicated app (split topology) so ${name} is reachable across apps, or drop ${app} as a consumer.`
        flags.push(msg)
        items.push({ app, key: name, action: "blocked", reason: msg })
        continue
      }
      const has = (existingByApp[app] ?? []).includes(name)
      if (has && !rotatedRef) {
        items.push({ app, key: name, action: "skip" })
        continue
      }
      const missingRef = refs.find((r) => runValues[r] === undefined)
      if (missingRef) {
        const msg = `cannot derive ${name} for ${app}: ${missingRef} is already set and its value is not retrievable. Re-run with \`--rotate ${missingRef}\` to re-establish it and all derived connections, or set ${name} manually.`
        flags.push(msg)
        items.push({ app, key: name, action: "blocked", reason: msg })
        continue
      }
      items.push({ app, key: name, action: "derive", value: resolveTemplate(c.template, runValues) })
    }
  }

  // 3. Manual secrets: block the apps that declare them but don't have them set.
  const manual = new Set(manifest.secrets.manual)
  for (const app of manifest.apps) {
    if (!inScope(app.name)) continue
    const toml = tomlByApp[app.name]
    if (!toml) continue
    const needed = new Set<string>([...toml.secrets, ...toml.services.flatMap((s) => s.secrets)])
    for (const m of manual) {
      if (!needed.has(m)) continue
      if (!(existingByApp[app.name] ?? []).includes(m)) {
        items.push({ app: app.name, key: m, action: "manual-missing", reason: `set it: lwd secret set ${app.name} ${m}` })
      }
    }
  }

  return { order: manifest.order.filter(inScope), items, flags }
}

/** Read each app's lwd.toml and the secret names lwd already holds, then plan. */
export async function computeStackDeploy(
  root: string,
  manifest: StackManifest,
  adapter: LwdAdapter,
  opts: PlanOptions = {},
): Promise<{ plan: StackPlan; tomlByApp: Record<string, LwdToml> }> {
  const tomlByApp: Record<string, LwdToml> = {}
  const existingByApp: Record<string, string[]> = {}
  for (const app of manifest.apps) {
    if (opts.onlyApp && app.name !== opts.onlyApp) continue
    const toml = await readLwdToml(path.join(root, app.manifest, "lwd.toml"))
    if (toml) tomlByApp[app.name] = toml
    existingByApp[app.name] = await adapter.secretLs(app.name)
  }
  return { plan: planSecrets(manifest, tomlByApp, existingByApp, opts), tomlByApp }
}

/** Log the plan, masking every value (a generated value never appears in output). */
export function printStackPlan(manifest: StackManifest, plan: StackPlan): void {
  const byApp = new Map<string, SecretPlanItem[]>()
  for (const it of plan.items) {
    const list = byApp.get(it.app) ?? []
    list.push(it)
    byApp.set(it.app, list)
  }
  log.info(`Stack "${manifest.name}" — apply order: ${plan.order.join(" → ")}`)
  for (const appName of plan.order) {
    const items = byApp.get(appName) ?? []
    log.plain(`  ${appName}`)
    if (items.length === 0) log.dim("    (no secrets)")
    for (const it of items) {
      if (it.action === "generate") log.plain(`    generate ${it.key} (hidden)`)
      else if (it.action === "derive") log.plain(`    derive   ${it.key} (hidden)`)
      else if (it.action === "skip") log.dim(`    skip     ${it.key} (already set)`)
      else if (it.action === "manual-missing") log.warn(`    MANUAL   ${it.key} — ${it.reason}`)
      else log.error(`    BLOCKED  ${it.key} — ${it.reason}`)
    }
  }
  if (plan.flags.length > 0) {
    log.plain("")
    log.error("Connectivity / derivation problems:")
    for (const f of plan.flags) log.plain("    - " + f)
  }
}

/** Execute the plan: set missing secrets per app in order, apply, gate on health. */
export async function executeStackDeploy(
  root: string,
  manifest: StackManifest,
  adapter: LwdAdapter,
  plan: StackPlan,
  opts: { noWait?: boolean } = {},
): Promise<void> {
  const appByName = new Map(manifest.apps.map((a) => [a.name, a]))
  for (const appName of plan.order) {
    const app = appByName.get(appName)
    if (!app) continue
    const items = plan.items.filter((i) => i.app === appName)

    const missingManual = items.filter((i) => i.action === "manual-missing")
    if (missingManual.length > 0) {
      log.error(`${appName}: unset required secrets — ${missingManual.map((m) => m.key).join(", ")}. Set them and re-run.`)
      throw new Error(`${appName} has unset manual secrets`)
    }

    for (const it of items) {
      if ((it.action === "generate" || it.action === "derive") && it.value !== undefined) {
        await adapter.secretSet(appName, it.key, it.value)
        log.success(`${appName}: set ${it.key}`)
      }
    }

    await adapter.apply(app.manifest)
    log.success(`${appName}: applied ${app.manifest}`)

    if (!opts.noWait) {
      const ok = await waitHealthy(adapter, appName)
      if (!ok) log.warn(`${appName}: not healthy yet — continuing (use lwd status ${appName} to check)`)
    }
  }
}

async function waitHealthy(adapter: LwdAdapter, app: string, tries = 30, delayMs = 2000): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const s = await adapter.status(app)
    if (s.healthy) return true
    if (/failed|error|crash/.test(s.state)) return false
    await new Promise((r) => setTimeout(r, delayMs))
  }
  return false
}
