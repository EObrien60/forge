import type { Plan } from "../project/plan"

export interface WorkerOptions {
  scope: string
}

/**
 * Generates a worker app. Consumers live in src/consumers.d/*.ts, each exporting
 * an optional `init(ctx)` and a `tick(ctx)`. The worker loads them by convention
 * and drives them on an interval — capabilities add background work by dropping
 * a file, never by editing the loop. Includes a plain-HTTP health port because
 * lwd surfaces (including workers) require one.
 */
export function addWorkerApp(plan: Plan, opts: WorkerOptions): void {
  const dir = "apps/worker"

  plan.create(
    `${dir}/package.json`,
    JSON.stringify(
      {
        name: `${opts.scope}/worker`,
        version: "0.1.0",
        private: true,
        scripts: {
          dev: "tsx watch src/main.ts",
          build: "tsc -p tsconfig.json",
          typecheck: "tsc -p tsconfig.json --noEmit",
          start: "node dist/main.js",
          test: "vitest run --passWithNoTests",
        },
        dependencies: { pg: "^8.12.0" },
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
    "worker app package.json",
  )

  plan.create(
    `${dir}/tsconfig.json`,
    JSON.stringify(
      {
        extends: "../../tsconfig.base.json",
        compilerOptions: { rootDir: "src", outDir: "dist" },
        include: ["src"],
        exclude: ["dist", "node_modules", "src/**/*.test.ts"],
      },
      null,
      2,
    ) + "\n",
    "worker tsconfig",
  )

  plan.create(`${dir}/src/context.ts`, CONTEXT, "worker context (pool + logger)")
  plan.create(`${dir}/src/main.ts`, MAIN, "worker loop (auto-loads src/consumers.d/*)")
  plan.create(`${dir}/src/consumers.d/.gitkeep`, "", "worker consumers directory")
  plan.create(`${dir}/Dockerfile`, DOCKERFILE, "worker Dockerfile")
}

const CONTEXT = `import { Pool } from "pg"

export interface WorkerContext {
  pool: Pool
  log: (msg: string, fields?: Record<string, unknown>) => void
}

export function createContext(): WorkerContext {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("DATABASE_URL is not set")
  const pool = new Pool({ connectionString: databaseUrl })
  return {
    pool,
    log: (msg, fields) => console.log(JSON.stringify({ msg, ...fields })),
  }
}
`

const MAIN = `import { createServer } from "node:http"
import { readdirSync } from "node:fs"
import path from "node:path"
import { createContext, type WorkerContext } from "./context"

interface Consumer {
  name: string
  init?: (ctx: WorkerContext) => Promise<void> | void
  tick: (ctx: WorkerContext) => Promise<void> | void
}

function loadConsumers(): Consumer[] {
  const dir = path.join(__dirname, "consumers.d")
  const out: Consumer[] = []
  for (const file of readdirSync(dir).sort()) {
    if (!/\\.(ts|js)$/.test(file) || file.endsWith(".d.ts")) continue
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(path.join(dir, file))
    if (typeof mod.tick === "function") {
      out.push({ name: file.replace(/\\.(ts|js)$/, ""), init: mod.init, tick: mod.tick })
    }
  }
  return out
}

async function main(): Promise<void> {
  const ctx = createContext()
  const consumers = loadConsumers()
  const pollMs = Number(process.env.POLL_INTERVAL_MS) || 1000

  for (const c of consumers) {
    if (c.init) await c.init(ctx)
    ctx.log("consumer registered", { consumer: c.name })
  }

  // lwd requires a health port even for a worker surface.
  const port = Number(process.env.PORT) || 8080
  createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ status: "ok" }))
  }).listen(port, () => ctx.log("worker health listening", { port }))

  let ticking = false
  const timer = setInterval(async () => {
    if (ticking) return
    ticking = true
    try {
      for (const c of consumers) await c.tick(ctx)
    } catch (err) {
      ctx.log("tick failed", { error: err instanceof Error ? err.message : String(err) })
    } finally {
      ticking = false
    }
  }, pollMs)

  const shutdown = async (): Promise<void> => {
    clearInterval(timer)
    await ctx.pool.end()
    process.exit(0)
  }
  process.on("SIGTERM", () => void shutdown())
  process.on("SIGINT", () => void shutdown())
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
`

const DOCKERFILE = `# Built by lwd from apps/worker (git.path = "apps/worker").
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
CMD ["node", "dist/main.js"]
`
