import type { CapabilityName, Topology } from "../types"
import type { Plan } from "../project/plan"

export interface SkeletonOptions {
  name: string
  topology: Topology
}

/**
 * Adds the project-level skeleton shared by every recipe: workspace config,
 * base tsconfig, migration runner, CI, and docs. Everything here is a safe
 * "create" — re-running never clobbers edited files.
 */
export function addProjectSkeleton(plan: Plan, opts: SkeletonOptions): void {
  const { name } = opts

  plan.create(
    "package.json",
    JSON.stringify(
      {
        name,
        private: true,
        version: "0.1.0",
        packageManager: "pnpm@9.7.0",
        engines: { node: ">=20" },
        scripts: {
          dev: "pnpm -r --parallel --filter './apps/*' dev",
          build: "pnpm -r build",
          typecheck: "pnpm -r typecheck",
          test: "pnpm -r test",
          migrate: "tsx scripts/migrate.ts",
        },
        devDependencies: {
          "@types/node": "^20.14.0",
          "@types/pg": "^8.11.6",
          pg: "^8.12.0",
          tsx: "^4.16.0",
          typescript: "^5.5.4",
        },
      },
      null,
      2,
    ) + "\n",
    "root workspace package.json",
  )

  plan.create(
    "pnpm-workspace.yaml",
    ["packages:", "  - apps/*", "  - packages/*", ""].join("\n"),
    "pnpm workspace definition",
  )

  plan.create(
    "tsconfig.base.json",
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "commonjs",
          moduleResolution: "node",
          lib: ["ES2022"],
          declaration: true,
          sourceMap: true,
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          resolveJsonModule: true,
          types: ["node"],
        },
      },
      null,
      2,
    ) + "\n",
    "shared TypeScript base config (CommonJS, matches @obh/* packages)",
  )

  plan.create(
    ".gitignore",
    ["node_modules/", "dist/", "coverage/", "*.log", ".env", ".env.local", ".DS_Store", ""].join("\n"),
    "gitignore",
  )

  plan.create(".env.example", envBase(name), "environment example")

  plan.create("migrations/0001_init.sql", INIT_SQL, "initial product migration")

  plan.create("scripts/migrate.ts", MIGRATE_RUNNER, "migration runner (SQL files + platform primitives)")
  plan.create("scripts/migrations.d/.gitkeep", "", "platform migration wiring directory")

  plan.create(".github/workflows/ci.yml", ciYaml(name), "GitHub Actions CI (build, typecheck, test, Postgres service)")

  plan.create("README.md", readme(name), "project readme")
  plan.create("AGENTS.md", agents(name), "conventions doc for humans and Claude skills")
}

const INIT_SQL = `-- 0001_init.sql — product schema baseline.
-- Product tables live in the default (public) schema.
-- OBH platform primitives own their own tables under the "platform" schema
-- and are migrated by their packages via scripts/migrations.d/*.

create table if not exists health_check (
  id integer primary key default 1,
  checked_at timestamptz not null default now()
);

insert into health_check (id) values (1) on conflict (id) do nothing;
`

const MIGRATE_RUNNER = `#!/usr/bin/env tsx
/**
 * Migration runner. Applies:
 *   1. Product SQL migrations in migrations/*.sql (tracked in _forge_migrations).
 *   2. Platform primitive migrations registered in scripts/migrations.d/*.
 *
 * Each \`forge add <primitive>\` drops a file into scripts/migrations.d/ that
 * exports \`migrate(pool)\`. This runner discovers them — nothing here is patched
 * by hand.
 */
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { Pool } from "pg"

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("DATABASE_URL is not set")
  const pool = new Pool({ connectionString: databaseUrl })

  try {
    await pool.query(
      \`create table if not exists _forge_migrations (
         name text primary key,
         applied_at timestamptz not null default now()
       )\`,
    )

    // 1. Product SQL migrations, in filename order.
    const migrationsDir = path.join(__dirname, "..", "migrations")
    const sqlFiles = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()
    for (const file of sqlFiles) {
      const done = await pool.query("select 1 from _forge_migrations where name = $1", [file])
      if (done.rowCount) continue
      const sql = readFileSync(path.join(migrationsDir, file), "utf8")
      await pool.query(sql)
      await pool.query("insert into _forge_migrations (name) values ($1)", [file])
      console.log("applied", file)
    }

    // 2. Platform primitive migrations (each capability drops a module here).
    const dir = path.join(__dirname, "migrations.d")
    const modules = readdirSync(dir).filter((f) => /\\.(ts|js)$/.test(f) && !f.startsWith("."))
    for (const file of modules.sort()) {
      const mod = await import(path.join(dir, file))
      if (typeof mod.migrate === "function") {
        await mod.migrate(pool)
        console.log("migrated platform:", file)
      }
    }
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
`

export function envBase(name: string): string {
  return `# ${name} environment
# Copy to .env and fill in. Never commit real secrets.

DATABASE_URL=postgres://postgres:postgres@localhost:5432/${name}
`
}

export function ciYaml(name: string): string {
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
          POSTGRES_DB: ${name}_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    env:
      DATABASE_URL: postgres://postgres:postgres@localhost:5432/${name}_test

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
      - run: pnpm build
      - run: pnpm typecheck
      - run: pnpm test
`
}

function readme(name: string): string {
  return `# ${name}

Scaffolded with [OBH Forge](https://github.com/EObrien60/forge).

## Layout

\`\`\`
apps/        deployable applications (api, admin, worker, …)
packages/    shared internal packages (sdk, ui, config)
deploy/      lwd deployment manifests
docker/      Dockerfiles
migrations/  product SQL migrations
scripts/     migrate, seed, dev helpers
forge.json   record of what Forge generated (see below)
\`\`\`

## Develop

\`\`\`bash
pnpm install
pnpm migrate      # apply product + platform migrations (needs DATABASE_URL)
pnpm dev          # run all apps
\`\`\`

## Platform primitives

Add OBH platform capabilities incrementally — each is opt-in:

\`\`\`bash
forge add events
forge add jobs
forge add files
forge add audit
\`\`\`

\`forge inspect\` reports the project shape; \`forge doctor\` checks it against
OBH conventions. \`forge.json\` records what was generated.

## Deploy

Deployment manifests live in \`deploy/*.lwd.toml\` and target lwd. Set secret
values out-of-band with \`lwd secret set <app> <KEY>\` — manifests contain secret
names only.
`
}

function agents(name: string): string {
  return `# ${name} — conventions

This project was scaffolded by OBH Forge. Conventions Claude skills and humans
can rely on:

- **Package manager:** pnpm workspace (\`apps/*\`, \`packages/*\`).
- **Language:** TypeScript, \`strict\`, CommonJS (matches \`@obh/*\` packages).
- **Database:** Postgres. Product tables in \`public\`; platform primitives own
  the \`platform\` schema. No ORM auto-sync — migrations run via \`pnpm migrate\`.
- **API:** routes in \`apps/api/src/routes/*.ts\`, each exporting \`register(app)\`;
  the server auto-mounts them. Add routes by dropping files, not editing a router.
- **Worker:** consumers in \`apps/worker/src/consumers.d/*.ts\`, auto-loaded.
- **Migrations:** platform primitives register in \`scripts/migrations.d/*.ts\`.
- **Deploy:** lwd manifests in \`deploy/*.lwd.toml\`; secret names only.
- **Record:** \`forge.json\` tracks generated shape and installed primitives.

Prefer boring, explicit code. Generated files are yours to edit or delete.
`
}
