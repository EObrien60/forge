import path from "node:path"
import type { AppRole, ConnectionSecret, GenerateSecret, StackApp, StackManifest } from "./types"
import { STACK_VERSION } from "./manifest"
import { readLwdToml, type LwdService, type LwdToml } from "./lwdtoml"
import { loadManifest } from "../project/manifest"
import { promises as fs } from "node:fs"

const RANDOM_SECRET_RE = /(^JWT_SECRET$|_SECRET$|_PEPPER$|_KEY$|_TOKEN$)/
const RESOURCE_IMAGE_RE = /^(postgres|redis|valkey|mysql|mariadb|mongo|minio)/

interface AppInfo {
  base: string
  manifestRel: string
  toml: LwdToml
}

interface PgSource {
  ownerApp: string
  /** Host used in the connection string: the service name (co-located) or app name (dedicated). */
  host: string
  user: string
  db: string
  coLocated: boolean
  passwordSecret: string
}

const ROLE_ORDER: Record<AppRole, number> = { resource: 0, api: 1, worker: 2, web: 3, app: 4 }

/** Inspect deploy/*.lwd.toml (+ forge.json) and propose a stack manifest. */
export async function inferStack(root: string): Promise<StackManifest> {
  const deployDir = path.join(root, "deploy")
  let dirs: string[] = []
  try {
    const entries = await fs.readdir(deployDir, { withFileTypes: true })
    dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    dirs = []
  }
  if (dirs.length === 0) throw new Error("no deploy/*/lwd.toml apps found — nothing to assemble into a stack")

  const forge = await loadManifest(root)
  const forgeRoles: Record<string, string> = {}
  for (const [name, app] of Object.entries(forge?.apps ?? {})) forgeRoles[name] = app.role

  const infos: AppInfo[] = []
  for (const dir of dirs.sort()) {
    const toml = await readLwdToml(path.join(deployDir, dir, "lwd.toml"))
    if (!toml || !toml.name) continue
    infos.push({ base: dir, manifestRel: `deploy/${dir}`, toml })
  }

  const apps: StackApp[] = infos.map((i) => ({
    name: i.toml.name,
    manifest: i.manifestRel,
    role: inferRole(i, forgeRoles),
  }))
  const roleOf = new Map(apps.map((a, i) => [infos[i].toml.name, a.role]))

  // Which apps need each secret (app top-level secrets + backing-service secrets).
  const needers = new Map<string, Set<string>>()
  const need = (secret: string, app: string): void => {
    const s = needers.get(secret) ?? new Set<string>()
    s.add(app)
    needers.set(secret, s)
  }
  for (const i of infos) {
    for (const s of i.toml.secrets) need(s, i.toml.name)
    for (const svc of i.toml.services) for (const s of svc.secrets) need(s, i.toml.name)
  }

  // Postgres sources: co-located [[services]] blocks + dedicated resource apps.
  const pgSources: PgSource[] = []
  for (const i of infos) {
    for (const svc of i.toml.services) {
      if (/^postgres/.test(svc.image)) pgSources.push(pgFromService(i.toml.name, svc))
    }
    // Compose app that bundles its own Postgres (service "db"): reachable within
    // the one app, so no cross-app flag.
    if (i.toml.compose && i.toml.secrets.some((s) => /PASSWORD/.test(s))) {
      pgSources.push({
        ownerApp: i.toml.name,
        host: "db",
        user: i.toml.env.POSTGRES_USER ?? "app",
        db: i.toml.env.POSTGRES_DB ?? "app",
        coLocated: true,
        passwordSecret: i.toml.secrets.find((s) => /PASSWORD/.test(s)) ?? "POSTGRES_PASSWORD",
      })
    }
    if (roleOf.get(i.toml.name) === "resource" && /^postgres/.test(i.toml.image ?? "")) {
      pgSources.push({
        ownerApp: i.toml.name,
        host: i.toml.name,
        user: i.toml.env.POSTGRES_USER ?? "app",
        db: i.toml.env.POSTGRES_DB ?? "app",
        coLocated: false,
        passwordSecret: i.toml.secrets.find((s) => /PASSWORD/.test(s)) ?? "POSTGRES_PASSWORD",
      })
    }
  }

  const generate: Record<string, GenerateSecret> = {}
  const connections: Record<string, ConnectionSecret> = {}
  const manual: string[] = []
  const classified = new Set<string>()

  // 1. Postgres password → generated on the owning app; DATABASE_URL → connection.
  for (const pg of pgSources) {
    generate[pg.passwordSecret] = { type: "password", bytes: 24, apps: [pg.ownerApp] }
    classified.add(pg.passwordSecret)

    if (needers.has("DATABASE_URL") && !connections.DATABASE_URL) {
      const consumers = [...(needers.get("DATABASE_URL") ?? [])]
      const template = `postgres://${pg.user}:\${${pg.passwordSecret}}@${pg.host}:5432/${pg.db}`
      if (pg.coLocated) {
        const owner = consumers.includes(pg.ownerApp) ? pg.ownerApp : consumers[0]
        connections.DATABASE_URL = {
          template,
          service: { app: pg.ownerApp, name: serviceNameOf(infos, pg.ownerApp) ?? "db" },
          apps: [owner],
          sharedWith: consumers.filter((a) => a !== owner),
        }
      } else {
        connections.DATABASE_URL = {
          template,
          service: { app: pg.ownerApp, name: pg.ownerApp },
          apps: consumers,
        }
      }
      classified.add("DATABASE_URL")
    }
  }

  // 2. Remaining secrets: random-looking → generate hex; else → manual.
  for (const [name, appsSet] of needers) {
    if (classified.has(name)) continue
    if (RANDOM_SECRET_RE.test(name)) {
      generate[name] = { type: "hex", bytes: 32, apps: [...appsSet] }
    } else {
      manual.push(name)
    }
  }
  manual.sort()

  const name = forge?.name ?? commonPrefix(apps.map((a) => a.name)) ?? path.basename(root)
  const order = [...apps].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]).map((a) => a.name)

  return { name, stackVersion: STACK_VERSION, apps, order, secrets: { generate, connections, manual } }
}

function pgFromService(ownerApp: string, svc: LwdService): PgSource {
  return {
    ownerApp,
    host: svc.name,
    user: svc.env.POSTGRES_USER ?? "app",
    db: svc.env.POSTGRES_DB ?? "app",
    coLocated: true,
    passwordSecret: svc.secrets.find((s) => /PASSWORD/.test(s)) ?? "POSTGRES_PASSWORD",
  }
}

function serviceNameOf(infos: AppInfo[], app: string): string | undefined {
  const info = infos.find((i) => i.toml.name === app)
  const pg = info?.toml.services.find((s) => /^postgres/.test(s.image))
  return pg?.name
}

function inferRole(info: AppInfo, forgeRoles: Record<string, string>): AppRole {
  const fr = forgeRoles[info.base]
  if (fr === "api" || fr === "web" || fr === "worker") return fr
  // A compose app is the fronted surface (bundles api+worker+db).
  if (info.toml.compose) return "api"
  const t = info.toml
  const isResource = (t.services.length > 0 && !t.git && !t.image) || (RESOURCE_IMAGE_RE.test(t.image ?? "") && !t.git)
  if (isResource) return "resource"
  if (/worker/i.test(t.name) || info.base === "worker") return "worker"
  if (t.port === 80 || info.base === "admin" || info.base === "web") return "web"
  return "api"
}

function commonPrefix(names: string[]): string | undefined {
  if (names.length === 0) return undefined
  const first = names[0]
  let prefix = ""
  for (let i = 0; i < first.length; i++) {
    const ch = first[i]
    if (names.every((n) => n[i] === ch)) prefix += ch
    else break
  }
  return prefix.replace(/[-_]$/, "") || undefined
}
