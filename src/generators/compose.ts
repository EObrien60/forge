import type { ForgeManifest } from "../types"
import type { Plan } from "../project/plan"
import { computeSecrets } from "./lwd"

/**
 * Compose deployment: bundle db + (migrate) + api + worker into ONE lwd compose
 * app so they share a docker-compose network — the worker reaches Postgres at
 * `db:5432` (lwd's per-app isolation only bites *across* lwd apps). lwd connects
 * the fronted `service` (api) to the lwd network for Caddy, so it's publicly
 * served. Secrets are passed through as env (lwd injects them into `docker
 * compose up`). The admin is a separate static app (it needs no DB).
 *
 * Tradeoff: a compose app is pinned to one node — no lwd blue-green / replicas /
 * scheduling for these services. Good enough for a single-box one-command deploy.
 */
export function addComposeDeployment(plan: Plan, manifest: ForgeManifest, gitUrl: string): void {
  const name = manifest.name
  const hasWorker = Object.values(manifest.apps).some((a) => a.role === "worker")
  const hasAdmin = Object.values(manifest.apps).some((a) => a.role === "web")
  const appSecrets = computeSecrets(manifest, true) // DATABASE_URL, JWT_SECRET, per-cap secrets
  const composeSecrets = [...new Set([...appSecrets, "POSTGRES_PASSWORD"])]

  plan.create("deploy/docker-compose.yml", composeYaml(name, hasWorker, appSecrets), "compose bundle (db + api + worker, shared network)")
  plan.create("docker/migrate.Dockerfile", MIGRATE_DOCKERFILE, "one-shot migration image (runs pnpm migrate on the compose network)")
  plan.create(`deploy/${name}.lwd.toml`, composeManifest(name, composeSecrets), "lwd compose app (fronts the api service)")

  if (hasAdmin) plan.create("deploy/admin.lwd.toml", adminManifest(name, gitUrl), "lwd manifest: admin (static, separate app)")

  plan.nextStep(`Deploy the whole stack with one command: forge deploy (runs on a box with lwd + this repo).`)
}

function composeYaml(name: string, hasWorker: boolean, appSecrets: string[]): string {
  // Secrets are passed through by name (no ${} interpolation): lwd sets them in
  // the `docker compose up` environment; `- NAME` forwards them to the container.
  const appEnv = appSecrets.map((s) => `      - ${s}`).join("\n")
  const worker = hasWorker
    ? `
  worker:
    build:
      context: ../apps/worker
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - ROLE=worker
${appSecrets.map((s) => `      - ${s}`).join("\n")}
    depends_on:
      db:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
`
    : ""
  return `# One lwd compose app: db + migrate + api${hasWorker ? " + worker" : ""} on a shared
# network. lwd runs \`docker compose up\` and fronts the api service via Caddy.
name: ${name}

services:
  db:
    image: postgres:16
    restart: unless-stopped
    environment:
      - POSTGRES_USER=${name}
      - POSTGRES_DB=${name}
      - POSTGRES_PASSWORD
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${name}"]
      interval: 10s
      timeout: 5s
      retries: 5

  migrate:
    build:
      context: ..
      dockerfile: docker/migrate.Dockerfile
    restart: "no"
    environment:
      - DATABASE_URL
    depends_on:
      db:
        condition: service_healthy

  api:
    build:
      context: ../apps/api
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=8080
${appEnv}
    depends_on:
      db:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
${worker}
volumes:
  db-data:
`
}

const MIGRATE_DOCKERFILE = `# One-shot migrator: applies product + platform migrations, then exits. Runs as a
# compose service on the shared network, so it reaches the db at its service name.
FROM node:20-alpine
WORKDIR /repo
RUN npm install -g pnpm@9
COPY . .
RUN pnpm install --no-frozen-lockfile
CMD ["pnpm", "migrate"]
`

function composeManifest(name: string, secrets: string[]): string {
  return [
    `name    = "${name}"`,
    `domain  = "go.${name}.example.com"`,
    `port    = 8080`,
    `node    = "local"          # compose apps run pinned on the local node`,
    `env     = { POSTGRES_USER = "${name}", POSTGRES_DB = "${name}" }`,
    `secrets = ${"[" + secrets.map((s) => `"${s}"`).join(", ") + "]"}`,
    ``,
    `# The whole stack (db + api + worker) is one compose project = one shared`,
    `# network. lwd fronts the "api" service; the worker reaches the db internally.`,
    `compose = "docker-compose.yml"`,
    `service = "api"`,
    ``,
  ].join("\n")
}

function adminManifest(name: string, gitUrl: string): string {
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
