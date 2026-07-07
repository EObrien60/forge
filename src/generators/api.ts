import type { ApiFramework, ExampleDomain } from "../types"
import type { Plan } from "../project/plan"

export interface ApiOptions {
  scope: string
  framework: ApiFramework
  example: ExampleDomain
}

/**
 * Generates the API app. Two framework flavours (Hono, Express) share the same
 * framework-agnostic core: a pg pool with a `withTx` helper, a transaction-aware
 * domain event bus (subscribers auto-loaded from src/bus.d/*), and — unless
 * disabled — a real `notes` domain (CRUD over Postgres that emits domain facts
 * inside its transaction). Routes auto-mount from src/routes/*.
 */
export function addApiApp(plan: Plan, opts: ApiOptions): void {
  const dir = "apps/api"
  const hono = opts.framework === "hono"

  plan.create(`${dir}/package.json`, packageJson(opts.scope, opts.framework), "API app package.json")
  plan.create(`${dir}/tsconfig.json`, tsconfig(), "API tsconfig")

  // Framework-agnostic core.
  plan.create(`${dir}/src/config.ts`, CONFIG, "API config loader")
  plan.create(`${dir}/src/db.ts`, DB, "API Postgres pool + withTx")
  plan.create(`${dir}/src/bus.ts`, BUS, "in-app domain event bus (auto-loads src/bus.d/*)")
  plan.create(`${dir}/src/bus.d/.gitkeep`, "", "bus subscribers directory")

  // Framework-specific server + health route.
  plan.create(`${dir}/src/server.ts`, hono ? SERVER_HONO : SERVER_EXPRESS, "API server (auto-mounts src/routes/*)")
  plan.create(`${dir}/src/routes/health.ts`, hono ? HEALTH_HONO : HEALTH_EXPRESS, "health route")

  // Example domain.
  if (opts.example === "notes") {
    plan.create(`${dir}/src/domain/notes.ts`, NOTES_DOMAIN, "notes domain (real CRUD + emits facts in-tx)")
    plan.create(`${dir}/src/routes/notes.ts`, hono ? NOTES_HONO : NOTES_EXPRESS, "notes CRUD route")
    plan.create("migrations/0002_notes.sql", NOTES_SQL, "notes table migration")
  }

  plan.create(`${dir}/Dockerfile`, DOCKERFILE, "API Dockerfile")
}

function packageJson(scope: string, framework: ApiFramework): string {
  const deps =
    framework === "hono"
      ? { "@hono/node-server": "^1.12.0", hono: "^4.5.0", pg: "^8.12.0" }
      : { cors: "^2.8.5", express: "^4.19.2", pg: "^8.12.0" }
  const devDeps =
    framework === "hono"
      ? { "@types/node": "^20.14.0", "@types/pg": "^8.11.6", tsx: "^4.16.0", typescript: "^5.5.4", vitest: "^2.0.5" }
      : {
          "@types/cors": "^2.8.17",
          "@types/express": "^4.17.21",
          "@types/node": "^20.14.0",
          "@types/pg": "^8.11.6",
          tsx: "^4.16.0",
          typescript: "^5.5.4",
          vitest: "^2.0.5",
        }
  return (
    JSON.stringify(
      {
        name: `${scope}/api`,
        version: "0.1.0",
        private: true,
        scripts: {
          dev: "tsx watch src/server.ts",
          build: "tsc -p tsconfig.json",
          typecheck: "tsc -p tsconfig.json --noEmit",
          start: "node dist/server.js",
          test: "vitest run --passWithNoTests",
        },
        dependencies: deps,
        devDependencies: devDeps,
      },
      null,
      2,
    ) + "\n"
  )
}

function tsconfig(): string {
  // Self-contained (not `extends: ../../tsconfig.base.json`): the app's Docker
  // build context is the app dir, so the repo-root base isn't available there.
  return (
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "commonjs",
          moduleResolution: "node",
          lib: ["ES2022"],
          rootDir: "src",
          outDir: "dist",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          resolveJsonModule: true,
          sourceMap: true,
          types: ["node"],
        },
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
  corsOrigins: string[]
}

export function loadConfig(): Config {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("DATABASE_URL is not set")
  return {
    port: Number(process.env.PORT) || 8080,
    databaseUrl,
    // Comma-separated allowlist; defaults to open in dev only.
    corsOrigins: (process.env.CORS_ORIGINS ?? "*").split(",").map((s) => s.trim()),
  }
}
`

const DB = `import { Pool, type PoolClient } from "pg"
import { loadConfig } from "./config"

export const pool = new Pool({ connectionString: loadConfig().databaseUrl })

export type Tx = PoolClient

/** Run work inside a transaction, committing on success and rolling back on error. */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query("begin")
    const result = await fn(client)
    await client.query("commit")
    return result
  } catch (err) {
    await client.query("rollback")
    throw err
  } finally {
    client.release()
  }
}
`

const BUS = `import { readdirSync } from "node:fs"
import path from "node:path"
import type { Tx } from "./db"

/**
 * Domain event bus. Domain code emits facts inside its transaction; subscribers
 * (dropped into src/bus.d/* by \`forge add events\`, etc.) receive them on the
 * SAME transaction, so durability follows the write. With no subscribers, emit
 * is a real no-op — not a stub.
 */
export type DomainEmitter = (tx: Tx, name: string, payload: unknown) => Promise<void>

const emitters: DomainEmitter[] = []

export function onEmit(fn: DomainEmitter): void {
  emitters.push(fn)
}

export async function emit(tx: Tx, name: string, payload: unknown): Promise<void> {
  for (const fn of emitters) await fn(tx, name, payload)
}

// Auto-load subscribers. Each module in bus.d calls onEmit() at import time.
const dir = path.join(__dirname, "bus.d")
try {
  for (const file of readdirSync(dir).sort()) {
    if (!/\\.(ts|js)$/.test(file) || file.endsWith(".d.ts")) continue
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require(path.join(dir, file))
  }
} catch {
  // no bus.d yet
}
`

const NOTES_DOMAIN = `import { randomUUID } from "node:crypto"
import { emit } from "../bus"
import { pool, withTx } from "../db"

export interface Note {
  id: string
  title: string
  body: string
  createdAt: string
  updatedAt: string
}

interface Row {
  id: string
  title: string
  body: string
  created_at: Date
  updated_at: Date
}

const toNote = (r: Row): Note => ({
  id: r.id,
  title: r.title,
  body: r.body,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
})

export async function listNotes(): Promise<Note[]> {
  const { rows } = await pool.query<Row>("select * from notes order by created_at desc")
  return rows.map(toNote)
}

export async function getNote(id: string): Promise<Note | null> {
  const { rows } = await pool.query<Row>("select * from notes where id = $1", [id])
  return rows[0] ? toNote(rows[0]) : null
}

export async function createNote(input: { title: string; body?: string }): Promise<Note> {
  return withTx(async (tx) => {
    const { rows } = await tx.query<Row>(
      "insert into notes (id, title, body) values ($1, $2, $3) returning *",
      [randomUUID(), input.title, input.body ?? ""],
    )
    const note = toNote(rows[0])
    await emit(tx, "note.created", note)
    return note
  })
}

export async function updateNote(id: string, input: { title?: string; body?: string }): Promise<Note | null> {
  return withTx(async (tx) => {
    const { rows } = await tx.query<Row>(
      "update notes set title = coalesce($2, title), body = coalesce($3, body), updated_at = now() where id = $1 returning *",
      [id, input.title ?? null, input.body ?? null],
    )
    if (!rows[0]) return null
    const note = toNote(rows[0])
    await emit(tx, "note.updated", note)
    return note
  })
}

export async function removeNote(id: string): Promise<boolean> {
  return withTx(async (tx) => {
    const { rows } = await tx.query<Row>("delete from notes where id = $1 returning *", [id])
    if (!rows[0]) return false
    await emit(tx, "note.deleted", toNote(rows[0]))
    return true
  })
}
`

const NOTES_SQL = `-- 0002_notes.sql — example domain table.
create table if not exists notes (
  id uuid primary key,
  title text not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`

const SERVER_HONO = `import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { readdirSync } from "node:fs"
import path from "node:path"
import { loadConfig } from "./config"

const app = new Hono()

// Auto-mount every route module in ./routes. Each exports register(app).
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

const SERVER_EXPRESS = `import cors from "cors"
import express from "express"
import { readdirSync } from "node:fs"
import path from "node:path"
import { loadConfig } from "./config"

const cfg = loadConfig()
const app = express()
app.use(cors({ origin: cfg.corsOrigins.includes("*") ? true : cfg.corsOrigins }))
app.use(express.json())

// Auto-mount every route module in ./routes. Each exports register(app).
const routesDir = path.join(__dirname, "routes")
for (const file of readdirSync(routesDir).sort()) {
  if (!/\\.(ts|js)$/.test(file) || file.endsWith(".d.ts")) continue
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(path.join(routesDir, file))
  if (typeof mod.register === "function") mod.register(app)
}

app.listen(cfg.port, () => console.log("api listening on :" + cfg.port))
`

const HEALTH_HONO = `import type { Hono } from "hono"
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

const HEALTH_EXPRESS = `import type { Express, Request, Response } from "express"
import { pool } from "../db"

export function register(app: Express): void {
  app.get("/health", async (_req: Request, res: Response) => {
    try {
      await pool.query("select 1")
      res.json({ status: "ok" })
    } catch {
      res.status(503).json({ status: "degraded" })
    }
  })
}
`

const NOTES_HONO = `import type { Hono } from "hono"
import * as notes from "../domain/notes"

export function register(app: Hono): void {
  app.get("/notes", async (c) => c.json(await notes.listNotes()))

  app.get("/notes/:id", async (c) => {
    const note = await notes.getNote(c.req.param("id"))
    return note ? c.json(note) : c.json({ error: "not found" }, 404)
  })

  app.post("/notes", async (c) => {
    const body = await c.req.json<{ title?: string; body?: string }>()
    if (!body.title) return c.json({ error: "title is required" }, 400)
    return c.json(await notes.createNote({ title: body.title, body: body.body }), 201)
  })

  app.put("/notes/:id", async (c) => {
    const body = await c.req.json<{ title?: string; body?: string }>()
    const note = await notes.updateNote(c.req.param("id"), body)
    return note ? c.json(note) : c.json({ error: "not found" }, 404)
  })

  app.delete("/notes/:id", async (c) => {
    const ok = await notes.removeNote(c.req.param("id"))
    return ok ? c.body(null, 204) : c.json({ error: "not found" }, 404)
  })
}
`

const NOTES_EXPRESS = `import type { Express, Request, Response } from "express"
import * as notes from "../domain/notes"

export function register(app: Express): void {
  app.get("/notes", async (_req: Request, res: Response) => {
    res.json(await notes.listNotes())
  })

  app.get("/notes/:id", async (req: Request, res: Response) => {
    const note = await notes.getNote(req.params.id)
    if (!note) return res.status(404).json({ error: "not found" })
    res.json(note)
  })

  app.post("/notes", async (req: Request, res: Response) => {
    if (!req.body.title) return res.status(400).json({ error: "title is required" })
    res.status(201).json(await notes.createNote({ title: req.body.title, body: req.body.body }))
  })

  app.put("/notes/:id", async (req: Request, res: Response) => {
    const note = await notes.updateNote(req.params.id, req.body)
    if (!note) return res.status(404).json({ error: "not found" })
    res.json(note)
  })

  app.delete("/notes/:id", async (req: Request, res: Response) => {
    const ok = await notes.removeNote(req.params.id)
    if (!ok) return res.status(404).json({ error: "not found" })
    res.status(204).end()
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
