import type { Plan } from "../project/plan"

export interface PlatformPackageOptions {
  /** Primitive name, e.g. "ratelimit" → package @obh/ratelimit. */
  name: string
  /** npm scope (default @obh). */
  scope: string
  /** Also generate a worker/admin daemon app. */
  daemon: boolean
}

const pascal = (name: string): string =>
  name
    .split(/[-_]/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("")

const snake = (name: string): string => name.replace(/-/g, "_")

/**
 * Generates a complete OBH platform-primitive repo (the qtool template): a pnpm
 * monorepo publishing @obh/<name>, CommonJS + strict, Postgres-native with the
 * standard pgAdapter / logger / ids / migrations kernel, a real record-store
 * client over a platform.<name> table, tests, and CI. Optionally an admin/worker
 * daemon. This is the single source that keeps new primitives consistent.
 */
export function addPlatformPackageProject(plan: Plan, opts: PlatformPackageOptions): void {
  const { name, scope, daemon } = opts
  const P = pascal(name)
  const table = `platform.${snake(name)}`
  const pkgDir = `packages/${name}`
  const idPrefix = snake(name).slice(0, 6)

  // ---- repo root ----
  plan.create("package.json", rootPackageJson(name), "root workspace package.json")
  plan.create("pnpm-workspace.yaml", "packages:\n  - packages/*\n  - apps/*\n", "pnpm workspace")
  plan.create("tsconfig.base.json", TSCONFIG_BASE, "shared TypeScript base (CommonJS, strict)")
  plan.create(".gitignore", "node_modules/\ndist/\ncoverage/\n*.log\n.env\n", "gitignore")
  plan.create("LICENSE", mitLicense(), "MIT license")
  plan.create("README.md", readme(name, scope, P), "readme")
  plan.create(".github/workflows/ci.yml", ci(name), "CI (postgres:16, build/typecheck/test)")

  // ---- packages/<name> ----
  plan.create(`${pkgDir}/package.json`, pkgPackageJson(name, scope), "package.json")
  plan.create(`${pkgDir}/tsconfig.json`, PKG_TSCONFIG, "package tsconfig")
  plan.create(`${pkgDir}/vitest.config.ts`, VITEST, "vitest config")
  plan.create(`${pkgDir}/src/index.ts`, indexTs(P), "public API surface")
  plan.create(`${pkgDir}/src/db.ts`, DB_TS, "db types")
  plan.create(`${pkgDir}/src/adapters/pg.ts`, PG_ADAPTER, "pgAdapter")
  plan.create(`${pkgDir}/src/logger.ts`, LOGGER, "structured logger")
  plan.create(`${pkgDir}/src/ids.ts`, IDS, "id generator")
  plan.create(`${pkgDir}/src/registry.ts`, registryTs(P), "definition registry")
  plan.create(`${pkgDir}/src/client.ts`, clientTs(P, table, idPrefix), "record-store client")
  plan.create(`${pkgDir}/src/migrations.ts`, migrationsTs(name, table), "migration runner")
  plan.create(`${pkgDir}/src/migrations/0001_init.sql`, initSql(table), "initial migration")
  plan.create(`${pkgDir}/src/__tests__/ids.test.ts`, IDS_TEST, "ids unit test")
  plan.create(`${pkgDir}/src/__tests__/registry.test.ts`, registryTest(P), "registry unit test")

  // ---- optional daemon ----
  if (daemon) {
    const appDir = `apps/${name}d`
    plan.create(`${appDir}/package.json`, daemonPackageJson(name, scope), "daemon package.json")
    plan.create(`${appDir}/tsconfig.json`, PKG_TSCONFIG, "daemon tsconfig")
    plan.create(`${appDir}/src/config.ts`, DAEMON_CONFIG, "daemon config")
    plan.create(`${appDir}/src/migrate.ts`, daemonMigrate(scope, name), "migrate binary")
    plan.create(`${appDir}/src/main.ts`, daemonMain(scope, name), "daemon entry (migrate + heartbeat)")
  }

  plan.nextStep(`cd ${name} && pnpm install && pnpm build`)
  if (daemon) plan.nextStep(`Apply schema: DATABASE_URL=… pnpm --filter ${scope}/${name}d migrate`)
  plan.nextStep(`Rename ${P}Record / create${P}Client in packages/${name}/src to your domain.`)
}

// ---------------------------------------------------------------------------

function rootPackageJson(name: string): string {
  return (
    JSON.stringify(
      {
        name,
        private: true,
        version: "0.1.0",
        packageManager: "pnpm@9.7.0",
        engines: { node: ">=20" },
        scripts: { build: "pnpm -r build", typecheck: "pnpm -r typecheck", test: "pnpm -r test" },
        devDependencies: { typescript: "^5.5.4" },
      },
      null,
      2,
    ) + "\n"
  )
}

const TSCONFIG_BASE = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "types": ["node"]
  }
}
`

const PKG_TSCONFIG = `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist", "composite": true },
  "include": ["src"],
  "exclude": ["dist", "node_modules", "src/**/*.test.ts"]
}
`

const VITEST = `import { defineConfig } from "vitest/config"

export default defineConfig({ test: { include: ["src/**/*.test.ts"] } })
`

function pkgPackageJson(name: string, scope: string): string {
  return (
    JSON.stringify(
      {
        name: `${scope}/${name}`,
        version: "0.1.0",
        license: "MIT",
        main: "dist/index.js",
        types: "dist/index.d.ts",
        files: ["dist", "src/migrations"],
        scripts: {
          build: "tsc -p tsconfig.json",
          typecheck: "tsc -p tsconfig.json --noEmit",
          test: "vitest run",
        },
        devDependencies: {
          "@types/node": "^20.14.0",
          "@types/pg": "^8.11.6",
          pg: "^8.12.0",
          typescript: "^5.5.4",
          vitest: "^2.0.5",
        },
      },
      null,
      2,
    ) + "\n"
  )
}

function indexTs(P: string): string {
  return `// Public surface of the package. Keep this small and boring.
export type { Db, TransactionalDb, QueryResult } from "./db"
export { pgAdapter } from "./adapters/pg"
export { createLogger } from "./logger"
export type { Logger, LogLevel, LogFields } from "./logger"
export { newId } from "./ids"

export { define${P}, create${P}Registry } from "./registry"
export type { ${P}Definition, ${P}Registry } from "./registry"

export { create${P}Client } from "./client"
export type { ${P}Client, ${P}Record } from "./client"

export { runMigrations, migrations, INIT_SQL } from "./migrations"
export type { Migration } from "./migrations"
`
}

const DB_TS = `export interface QueryResult<T> {
  rows: T[]
}

export interface Db {
  query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>>
}

export interface TransactionalDb extends Db {
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>
}
`

const PG_ADAPTER = `import type { Db, QueryResult, TransactionalDb } from "../db"

type PgQueryable = { query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }> }
type PgClient = PgQueryable & { release: () => void }
type PgPool = PgQueryable & { connect: () => Promise<PgClient> }

/** Wrap a node-postgres Pool as a TransactionalDb. */
export function pgAdapter(pool: PgPool): TransactionalDb {
  const query = async <T>(sql: string, params?: unknown[]): Promise<QueryResult<T>> => {
    const res = await pool.query(sql, params)
    return { rows: res.rows as T[] }
  }
  return {
    query,
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      const client = await pool.connect()
      const tx: Db = {
        async query<U>(sql: string, params?: unknown[]): Promise<QueryResult<U>> {
          const res = await client.query(sql, params)
          return { rows: res.rows as U[] }
        },
      }
      try {
        await client.query("begin")
        const result = await fn(tx)
        await client.query("commit")
        return result
      } catch (err) {
        await client.query("rollback")
        throw err
      } finally {
        client.release()
      }
    },
  }
}
`

const LOGGER = `export type LogLevel = "debug" | "info" | "warn" | "error"
export type LogFields = Record<string, unknown>

export interface Logger {
  debug(msg: string, fields?: LogFields): void
  info(msg: string, fields?: LogFields): void
  warn(msg: string, fields?: LogFields): void
  error(msg: string, fields?: LogFields): void
  child(base: LogFields): Logger
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export function createLogger(level: LogLevel = "info", base: LogFields = {}): Logger {
  const at = (lvl: LogLevel, msg: string, fields?: LogFields): void => {
    if (ORDER[lvl] < ORDER[level]) return
    console.log(JSON.stringify({ level: lvl, msg, ...base, ...fields }))
  }
  return {
    debug: (m, f) => at("debug", m, f),
    info: (m, f) => at("info", m, f),
    warn: (m, f) => at("warn", m, f),
    error: (m, f) => at("error", m, f),
    child: (b) => createLogger(level, { ...base, ...b }),
  }
}
`

const IDS = `import { randomUUID } from "node:crypto"

/** Generate a prefixed, sortable-enough id, e.g. newId("wid") -> "wid_<uuid>". */
export function newId(prefix: string): string {
  return prefix + "_" + randomUUID()
}
`

function registryTs(P: string): string {
  return `export interface ${P}Definition {
  name: string
}

export interface ${P}Registry {
  register(def: ${P}Definition): void
  get(name: string): ${P}Definition | undefined
  list(): ${P}Definition[]
}

export function define${P}(def: ${P}Definition): ${P}Definition {
  return def
}

export function create${P}Registry(): ${P}Registry {
  const defs = new Map<string, ${P}Definition>()
  return {
    register: (def) => void defs.set(def.name, def),
    get: (name) => defs.get(name),
    list: () => [...defs.values()],
  }
}
`
}

function clientTs(P: string, table: string, idPrefix: string): string {
  return `import type { Db } from "./db"
import { newId } from "./ids"

export interface ${P}Record {
  id: string
  workspaceId: string
  kind: string
  key: string
  value: unknown
  createdAt: string
}

interface Row {
  id: string
  workspace_id: string
  kind: string
  key: string
  value: unknown
  created_at: Date
}

const toRecord = (r: Row): ${P}Record => ({
  id: r.id,
  workspaceId: r.workspace_id,
  kind: r.kind,
  key: r.key,
  value: r.value,
  createdAt: r.created_at.toISOString(),
})

export interface ${P}Client {
  put(input: { workspaceId: string; kind: string; key: string; value: unknown }): Promise<${P}Record>
  get(workspaceId: string, kind: string, key: string): Promise<${P}Record | null>
  list(workspaceId: string, kind: string): Promise<${P}Record[]>
}

/** A boring, workspace-scoped record store. Reshape to your primitive's domain. */
export function create${P}Client(opts: { db: Db }): ${P}Client {
  const { db } = opts
  return {
    async put(input) {
      const { rows } = await db.query<Row>(
        \`insert into ${table} (id, workspace_id, kind, key, value)
         values ($1, $2, $3, $4, $5::jsonb)
         on conflict (workspace_id, kind, key) do update set value = excluded.value
         returning *\`,
        [newId("${idPrefix}"), input.workspaceId, input.kind, input.key, JSON.stringify(input.value)],
      )
      return toRecord(rows[0])
    },
    async get(workspaceId, kind, key) {
      const { rows } = await db.query<Row>(
        \`select * from ${table} where workspace_id = $1 and kind = $2 and key = $3\`,
        [workspaceId, kind, key],
      )
      return rows[0] ? toRecord(rows[0]) : null
    },
    async list(workspaceId, kind) {
      const { rows } = await db.query<Row>(
        \`select * from ${table} where workspace_id = $1 and kind = $2 order by created_at desc\`,
        [workspaceId, kind],
      )
      return rows.map(toRecord)
    },
  }
}
`
}

function migrationsTs(name: string, table: string): string {
  const tracking = `platform.${snake(name)}_migrations`
  return `import type { Db } from "./db"

export interface Migration {
  name: string
  sql: string
}

export const INIT_SQL = \`${initSql(table)}\`

export const migrations: Migration[] = [{ name: "0001_init", sql: INIT_SQL }]

/** Idempotently apply all migrations. */
export async function runMigrations(db: Db): Promise<void> {
  await db.query("create schema if not exists platform")
  await db.query(
    "create table if not exists ${tracking} (name text primary key, applied_at timestamptz not null default now())",
  )
  for (const m of migrations) {
    const { rows } = await db.query<{ name: string }>("select name from ${tracking} where name = $1", [m.name])
    if (rows.length) continue
    await db.query(m.sql)
    await db.query("insert into ${tracking} (name) values ($1)", [m.name])
  }
}
`
}

function initSql(table: string): string {
  return `create schema if not exists platform;

create table if not exists ${table} (
  id text primary key,
  workspace_id text not null,
  kind text not null,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, kind, key)
);
`
}

const IDS_TEST = `import { describe, expect, it } from "vitest"
import { newId } from "../ids"

describe("newId", () => {
  it("prefixes and is unique", () => {
    const a = newId("t")
    const b = newId("t")
    expect(a.startsWith("t_")).toBe(true)
    expect(a).not.toBe(b)
  })
})
`

function registryTest(P: string): string {
  return `import { describe, expect, it } from "vitest"
import { create${P}Registry, define${P} } from "../registry"

describe("registry", () => {
  it("registers and lists definitions", () => {
    const registry = create${P}Registry()
    registry.register(define${P}({ name: "example" }))
    expect(registry.get("example")?.name).toBe("example")
    expect(registry.list()).toHaveLength(1)
  })
})
`
}

// ---- daemon ----

function daemonPackageJson(name: string, scope: string): string {
  return (
    JSON.stringify(
      {
        name: `${scope}/${name}d`,
        version: "0.1.0",
        private: true,
        bin: { [`obh-${name}d`]: "dist/main.js" },
        scripts: {
          build: "tsc -p tsconfig.json",
          typecheck: "tsc -p tsconfig.json --noEmit",
          start: "node dist/main.js",
          migrate: "node dist/migrate.js",
          test: "vitest run --passWithNoTests",
        },
        dependencies: { [`${scope}/${name}`]: "workspace:*", pg: "^8.12.0" },
        devDependencies: {
          "@types/node": "^20.14.0",
          "@types/pg": "^8.11.6",
          typescript: "^5.5.4",
          vitest: "^2.0.5",
        },
      },
      null,
      2,
    ) + "\n"
  )
}

const DAEMON_CONFIG = `export function loadConfig(): { databaseUrl: string; logLevel: string; pollIntervalMs: number } {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("DATABASE_URL is not set")
  return {
    databaseUrl,
    logLevel: process.env.LOG_LEVEL ?? "info",
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 1000,
  }
}
`

function daemonMigrate(scope: string, name: string): string {
  return `#!/usr/bin/env node
import { pgAdapter, runMigrations } from "${scope}/${name}"
import { Pool } from "pg"
import { loadConfig } from "./config"

async function main(): Promise<void> {
  const cfg = loadConfig()
  const pool = new Pool({ connectionString: cfg.databaseUrl })
  try {
    await runMigrations(pgAdapter(pool))
    console.log("migrations applied")
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
`
}

function daemonMain(scope: string, name: string): string {
  return `#!/usr/bin/env node
import { createLogger, pgAdapter, runMigrations } from "${scope}/${name}"
import { Pool } from "pg"
import { loadConfig } from "./config"

async function main(): Promise<void> {
  const cfg = loadConfig()
  const log = createLogger(cfg.logLevel as "info")
  const pool = new Pool({ connectionString: cfg.databaseUrl })
  await runMigrations(pgAdapter(pool))
  log.info("daemon started")

  let running = true
  const tick = async (): Promise<void> => {
    // Add background work here (sweeps, retries, rollups) as the primitive grows.
  }
  const timer = setInterval(() => void tick(), cfg.pollIntervalMs)

  const shutdown = async (): Promise<void> => {
    if (!running) return
    running = false
    clearInterval(timer)
    await pool.end()
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
}

function ci(name: string): string {
  return `name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: ${snake(name)}_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL: postgres://postgres:postgres@localhost:5432/${snake(name)}_test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --no-frozen-lockfile
      - run: pnpm -r build
      - run: pnpm -r test
`
}

function readme(name: string, scope: string, P: string): string {
  return `# ${name}

\`${scope}/${name}\` — an OBH platform primitive, scaffolded by [OBH Forge](https://github.com/EObrien60/forge).

Postgres-backed, framework-agnostic, standalone. Public API:

\`\`\`ts
import { create${P}Client, pgAdapter, runMigrations } from "${scope}/${name}"
import { Pool } from "pg"

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
await runMigrations(pgAdapter(pool))

const client = create${P}Client({ db: pgAdapter(pool) })
await client.put({ workspaceId: "ws1", kind: "example", key: "k", value: { any: "json" } })
\`\`\`

Tables live under the shared \`platform\` schema. Reshape \`${P}Record\` /
\`create${P}Client\` to your primitive's real domain — the record store is a
starting point, not a straitjacket.

## Develop

\`\`\`bash
pnpm install
pnpm build
pnpm test      # unit + Postgres integration (set DATABASE_URL)
\`\`\`
`
}

function mitLicense(): string {
  return `MIT License

Copyright (c) 2026 OBH Software

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
`
}
