import type { Plan } from "../project/plan"

export interface ApiOptions {
  scope: string
}

/**
 * Generates a Hono API app. Routes live in src/routes/*.ts, each exporting
 * `register(app)`; the server auto-mounts them, so capabilities add routes by
 * dropping files rather than editing a central router.
 */
export function addApiApp(plan: Plan, opts: ApiOptions): void {
  const dir = "apps/api"

  plan.create(
    `${dir}/package.json`,
    JSON.stringify(
      {
        name: `${opts.scope}/api`,
        version: "0.1.0",
        private: true,
        scripts: {
          dev: "tsx watch src/server.ts",
          build: "tsc -p tsconfig.json",
          typecheck: "tsc -p tsconfig.json --noEmit",
          start: "node dist/server.js",
          test: "vitest run --passWithNoTests",
        },
        dependencies: {
          "@hono/node-server": "^1.12.0",
          hono: "^4.5.0",
          pg: "^8.12.0",
        },
        devDependencies: {
          "@types/node": "^20.14.0",
          "@types/pg": "^8.11.6",
          tsx: "^4.16.0",
          typescript: "^5.5.4",
          vitest: "^2.0.5",
        },
      },
      null,
      2,
    ) + "\n",
    "API app package.json",
  )

  plan.create(`${dir}/tsconfig.json`, appTsconfig(), "API tsconfig")

  plan.create(`${dir}/src/config.ts`, CONFIG, "API config loader")
  plan.create(`${dir}/src/db.ts`, DB, "API Postgres pool")
  plan.create(`${dir}/src/server.ts`, SERVER, "API server (auto-mounts src/routes/*)")
  plan.create(`${dir}/src/routes/health.ts`, HEALTH_ROUTE, "health route")
  plan.create(`${dir}/Dockerfile`, DOCKERFILE, "API Dockerfile")
}

function appTsconfig(): string {
  return (
    JSON.stringify(
      {
        extends: "../../tsconfig.base.json",
        compilerOptions: { rootDir: "src", outDir: "dist" },
        include: ["src"],
        exclude: ["dist", "node_modules", "src/**/*.test.ts"],
      },
      null,
      2,
    ) + "\n"
  )
}

const CONFIG = `export interface Config {
  port: number
  databaseUrl: string
}

export function loadConfig(): Config {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("DATABASE_URL is not set")
  return {
    port: Number(process.env.PORT) || 8080,
    databaseUrl,
  }
}
`

const DB = `import { Pool } from "pg"
import { loadConfig } from "./config"

// One shared pool for the process. Platform primitives wrap this with their
// package's pgAdapter, e.g. \`eventsPgAdapter(pool)\`.
export const pool = new Pool({ connectionString: loadConfig().databaseUrl })
`

const SERVER = `import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { readdirSync } from "node:fs"
import path from "node:path"
import { loadConfig } from "./config"

const app = new Hono()

// Auto-mount every route module in ./routes. Each exports \`register(app)\`.
// Works under tsx (.ts, dev) and compiled node (.js, prod).
const routesDir = path.join(__dirname, "routes")
for (const file of readdirSync(routesDir).sort()) {
  if (!/\\.(ts|js)$/.test(file) || file.endsWith(".d.ts")) continue
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(path.join(routesDir, file))
  if (typeof mod.register === "function") mod.register(app)
}

const cfg = loadConfig()
serve({ fetch: app.fetch, port: cfg.port })
console.log("api listening on :" + cfg.port)
`

const HEALTH_ROUTE = `import type { Hono } from "hono"
import { pool } from "../db"

export function register(app: Hono): void {
  app.get("/health", async (c) => {
    try {
      await pool.query("select 1")
      return c.json({ status: "ok" })
    } catch {
      return c.json({ status: "degraded" }, 503)
    }
  })
}
`

const DOCKERFILE = `# Built by lwd from apps/api (git.path = "apps/api").
FROM node:20-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@9
COPY package.json ./
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN pnpm build

FROM node:20-alpine
WORKDIR /app
RUN npm install -g pnpm@9
COPY package.json ./
RUN pnpm install --prod --no-frozen-lockfile
COPY --from=builder /app/dist ./dist
EXPOSE 8080
CMD ["node", "dist/server.js"]
`
