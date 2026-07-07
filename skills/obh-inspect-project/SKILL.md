---
name: obh-inspect-project
description: Use when you need to understand an unfamiliar or pre-Forge codebase before changing it. Reads the repo and reports project shape, DB and deploy patterns, which OBH platform primitives are present vs. candidates, risks, and a recommended `forge add` sequence.
---

Purpose: build an accurate map of a repository so subsequent Forge/retrofit work is grounded in what actually exists, not assumptions. This skill only reads and reports — it makes no changes.

## Workflow

1. **Detect project shape.** Look for `forge.json` first — if present, read the recorded apps, packages, installed primitives, and topology; the repo is already Forge-managed. Otherwise infer: check for `pnpm-workspace.yaml` + `apps/*` + `packages/*` (Forge-style monorepo) vs. a single-package app. List every app and package with its role (api, admin, worker, mobile, sdk, ui, config).

2. **Identify the package manager.** `pnpm-lock.yaml` → pnpm (Forge default), `package-lock.json` → npm, `yarn.lock` → yarn. Note if mixed lockfiles exist (a risk).

3. **Determine the DB access pattern.** Grep for: raw `pg` / `Pool` / `client.query` (raw SQL — Forge-native); `typeorm`, `@mikro-orm`, `prisma`, `sequelize`, `drizzle` (ORM). Record whether schema is managed by migrations (`migrations/*.sql`, `scripts/migrate.ts`) or by ORM `synchronize`/auto-sync. Note the schemas in use — product tables belong in `public`, OBH primitives own `platform`.

4. **Map deployment.** Look for `deploy/*.lwd.toml` (Forge/lwd), `Dockerfile`, `docker-compose.yml`, `vercel.json`, `fly.toml`, k8s manifests, CI workflows. Note where secrets live (committed `.env`, CI secrets, lwd secret names).

5. **Census platform primitives.** For each OBH primitive (events, jobs, files, audit, settings, api-keys, webhooks, import-export, entitlements, search, analytics, notifications), decide **present** (an `@obh/*` dep or a `scripts/migrations.d/*` entry) vs. **candidate** (hand-rolled equivalent exists — e.g. a homegrown outbox table, a cron route, multer uploads, a `settings`/`options` table). Cite the file that triggered each candidate.

6. **Flag risks.** Watch for: ORM auto-sync/`synchronize: true` (schema drift, no reviewable migrations); missing migrations directory; no `/health` or readiness endpoint; duplicated types between backend and frontend(s); committed secrets; missing event seam (writes with no facts emitted); a worker surface mixed into the API process.

7. **Recommend a `forge add` sequence.** Order by dependency: `events` first (most primitives react to events), then the primitives that consume them (`audit`, `analytics`, `notifications`, `search`), then independent ones (`files`, `jobs`, `settings`, `api-keys`, `webhooks`, `import-export`, `entitlements`). Only recommend primitives justified by a real candidate. Suggest `forge inspect` and `forge doctor` to validate before mutating, and note every mutating command supports `--dry-run`.

## Output

A concise report with sections: **Shape** (apps/packages + package manager), **Data** (DB access + migration strategy + schemas), **Deploy** (surfaces + secrets), **Primitives** (present vs. candidate table, each candidate citing a file), **Risks** (ranked), and **Recommended sequence** (an ordered list of `forge add <primitive>` commands with a one-line reason each, prefixed with a `forge doctor` / `--dry-run` note). No code changes.
