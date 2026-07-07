import type { CapabilityName, ForgeManifest, Topology } from "../types"
import type { Plan } from "../project/plan"

/** Base secret names every project needs, plus per-capability additions. */
const CAPABILITY_SECRETS: Partial<Record<CapabilityName, string[]>> = {
  "api-keys": ["API_KEYS_PEPPER"],
  webhooks: ["WEBHOOK_SECRET_ENCRYPTION_KEY"],
  files: ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"],
  notifications: ["SMTP_URL"],
}

/** Compute the ordered, de-duplicated list of lwd secret names for an app. */
export function computeSecrets(manifest: ForgeManifest, includeAuth: boolean): string[] {
  const secrets = new Set<string>(["DATABASE_URL"])
  if (includeAuth) secrets.add("JWT_SECRET")
  for (const [cap, enabled] of Object.entries(manifest.platform)) {
    if (!enabled) continue
    for (const s of CAPABILITY_SECRETS[cap as CapabilityName] ?? []) secrets.add(s)
  }
  return [...secrets]
}

/**
 * Generate lwd deployment manifests for the project's current shape. Emits
 * secret NAMES only (values set via `lwd secret set`). Encodes the two hard lwd
 * constraints: a scalable API can't carry a `[[services]]` db, and a separate
 * worker app can't reach another app's isolated backing network.
 */
export function addLwdManifests(plan: Plan, manifest: ForgeManifest): void {
  const name = manifest.name
  const topology = manifest.deploy.topology
  const hasApi = manifest.apps.api !== undefined || Object.values(manifest.apps).some((a) => a.role === "api")
  const hasAdmin = Object.values(manifest.apps).some((a) => a.role === "web")
  const hasWorker = Object.values(manifest.apps).some((a) => a.role === "worker")
  const includeAuth = true
  const secrets = computeSecrets(manifest, includeAuth)
  const gitUrl = repoUrl(manifest.deploy.repo, name)

  if (hasApi) {
    plan.create(`deploy/api.lwd.toml`, apiManifest(name, topology, secrets, gitUrl), "lwd manifest: API surface")
  }
  if (hasAdmin) {
    plan.create(`deploy/admin.lwd.toml`, adminManifest(name, gitUrl), "lwd manifest: admin frontend")
  }
  if (hasWorker) {
    plan.create(`deploy/worker.lwd.toml`, workerManifest(name, secrets.filter((s) => s === "DATABASE_URL"), gitUrl), "lwd manifest: worker surface")
  }
  if (topology === "split") {
    plan.create(`deploy/db.lwd.toml`, dbManifest(name), "lwd manifest: dedicated Postgres")
  }

  if (!manifest.deploy.repo) {
    plan.nextStep(`No git repo known — set the [git].url in deploy/*.lwd.toml before deploying.`)
  }
  plan.nextStep(`Set secret values: lwd secret set ${name}-api ${secrets.join(" ")}`)
}

/** Resolve a repo slug/url (or none) into a git URL for the manifests. */
function repoUrl(repo: string | undefined, name: string): string {
  if (!repo) return `https://github.com/${name}/${name}`
  if (repo.startsWith("http") || repo.startsWith("git@")) return repo.replace(/\.git$/, "")
  return `https://github.com/${repo}`
}

function tomlList(items: string[]): string {
  return "[" + items.map((s) => `"${s}"`).join(", ") + "]"
}

function apiManifest(name: string, topology: Topology, secrets: string[], gitUrl: string): string {
  // In split topology the API scales (replicas) and the DB is a separate app.
  // In small topology the API co-locates a Postgres backing service.
  const scalable = topology === "split"
  const lines = [
    `name    = "${name}-api"`,
    `domain  = "api.${name}.example.com"`,
    `port    = 8080`,
    `env     = { NODE_ENV = "production", LOG_LEVEL = "info" }`,
    `secrets = ${tomlList(secrets)}`,
  ]
  if (scalable) lines.push(`replicas = 2`)
  lines.push(
    ``,
    `[git]`,
    `url  = "${gitUrl}"`,
    `ref  = "main"`,
    `path = "apps/api"`,
    ``,
    `[build]`,
    `dockerfile = "Dockerfile"`,
    ``,
    `[health]`,
    `path    = "/health"`,
    `timeout = "30s"`,
  )
  if (!scalable) {
    lines.push(
      ``,
      `# Small topology: Postgres co-located as a backing service.`,
      `# NOTE: a co-located backing service means this app cannot use replicas > 1.`,
      `[[services]]`,
      `name    = "db"`,
      `image   = "postgres:16"`,
      `env     = { POSTGRES_USER = "${name}", POSTGRES_DB = "${name}" }`,
      `secrets = ["POSTGRES_PASSWORD"]`,
      `volume  = "db-data:/var/lib/postgresql/data"`,
    )
  }
  return lines.join("\n") + "\n"
}

function adminManifest(name: string, gitUrl: string): string {
  // Root-context build: the admin imports the workspace SDK, so the build needs
  // the whole repo. git.path = "." and the Dockerfile lives under apps/admin.
  return [
    `name   = "${name}-admin"`,
    `domain = "app.${name}.example.com"`,
    `port   = 80`,
    ``,
    `[git]`,
    `url  = "${gitUrl}"`,
    `ref  = "main"`,
    `path = "."`,
    ``,
    `[build]`,
    `context    = "."`,
    `dockerfile = "apps/admin/Dockerfile"`,
    ``,
    `[health]`,
    `path    = "/"`,
    `timeout = "30s"`,
    ``,
  ].join("\n")
}

function workerManifest(name: string, secrets: string[], gitUrl: string): string {
  return [
    `name    = "${name}-worker"`,
    `# lwd has no worker type: a worker is a normal surface app and still needs a`,
    `# domain + health port. In split topology point DATABASE_URL at ${name}-db.`,
    `domain  = "worker.internal.${name}.example.com"`,
    `port    = 8080`,
    `env     = { NODE_ENV = "production", ROLE = "worker" }`,
    `secrets = ${tomlList(secrets.length ? secrets : ["DATABASE_URL"])}`,
    ``,
    `[git]`,
    `url  = "${gitUrl}"`,
    `ref  = "main"`,
    `path = "apps/worker"`,
    ``,
    `[build]`,
    `dockerfile = "Dockerfile"`,
    ``,
    `[health]`,
    `path = "/health"`,
    ``,
  ].join("\n")
}

function dbManifest(name: string): string {
  return [
    `name    = "${name}-db"`,
    `image   = "postgres:16"`,
    `port    = 5432`,
    `env     = { POSTGRES_DB = "${name}", POSTGRES_USER = "${name}" }`,
    `secrets = ["POSTGRES_PASSWORD"]`,
    ``,
  ].join("\n")
}
