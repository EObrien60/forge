# `create-q-app` — Platform Architecture & Generator Design

*An architectural audit of `C:\dev` and the design document for the next-generation project generator. Grounded in the actual repositories as of 2026-07-06.*

## Preamble — the naming decision you must make first

Before anything else: there are **three competing naming schemes** in play, and the generator can't be designed until one wins.

| Layer | In your prompt | In reality (on disk) |
|---|---|---|
| npm scope | `@q/events` | `@obh/events` (all 12 repos, consistent) |
| package stem | `q-events`, `q-jobs` | `events`, `jobs`, `import-export`, `analytics`… |
| repo name | — | `qevents`, `qport`, `qmetric`, `qseek`… (codename ≠ package) |
| generator | `create-q-app` | does not exist yet |

The `@obh/*` scope is the one thing that is **already 100% consistent across all 12 published packages**. The `@q/*` scope in your prompt is aspirational. My recommendation, used throughout this document:

- **Keep `@obh/*` as the npm scope.** It's real, consistent, and renaming 12 *public* GitHub packages is pure churn for a cosmetic gain. `create-q-app` (the `q` = your product-family prefix: qMechanic, qHaul) can generate apps that depend on `@obh/*` with zero contradiction — `q` is the *product* brand, `obh` is the *platform vendor* brand. That separation is actually healthy.
- **Fix the codename↔package drift** by treating the **package name as authoritative** in all docs and the generator, and adding a one-line "repo `qport` → package `@obh/import-export`" table to each README. Don't rename repos.
- If you *do* want the rebrand to `@q/*`, do it once, mechanically, via a scoped-package alias release — but that's a separate project, not a prerequisite for the generator.

I'll flag where this choice changes generated output. Everywhere below, `@obh/*` = the real packages you already built.

---

# 1. Workspace inventory

| Project | Purpose | Language | Framework | Package type | Runtime | Build | Deploy | Testing | Pkg mgr |
|---|---|---|---|---|---|---|---|---|---|
| **lwd** | Self-hosted deployment/runtime platform (mini Fly.io/Nomad) | Go | stdlib + Caddy | binaries (`lwd`, `lwd-agent`, `lwd-mcp`, `lwd-web`) | Docker daemon on nodes | `go build` | self (bootstraps itself) | Go `_test.go`, extensive | Go modules |
| **qMechanic** | Fleet/vehicle-maintenance SaaS (real product) | TS | Express+TypeORM / React+Vite / Expo | pnpm monorepo, 4 apps | Node (PM2) + Vercel + nginx + RN | tsc / vite / eas | **dual: Vercel *and* lwd** | ~none (AGENTS says "not yet scaffolded") | pnpm 8.15.4 |
| **qevents** | Event outbox + dispatcher | TS | none (lib+daemon) | pnpm monorepo | Node ≥20 | tsc | lwd (implied) | vitest + PG-integration, CI | pnpm 9.7.0 |
| **qjobs** | Postgres job queue + worker | TS | lib+daemon | pnpm monorepo | Node | tsc | lwd | vitest, **CI** | pnpm |
| **qnotify** | Email notification engine | TS | lib+daemon | pnpm monorepo | Node | tsc | lwd | vitest, **compose, no CI** | pnpm |
| **qstore** | S3-compatible file service | TS | lib+HTTP service | pnpm monorepo | Node | tsc | lwd | vitest, **CI + compose** (only repo with both) | pnpm |
| **qaudit** | Immutable audit log | TS | lib+daemon | pnpm monorepo | Node | tsc | lwd | vitest, **compose, no CI** | pnpm |
| **qsettings** | Typed scoped config | TS | pure lib (+example app) | pnpm monorepo | Node | tsc | n/a (lib) | vitest, CI | pnpm |
| **qkeys** | Scoped machine API keys | TS | pure lib (+hono adapter +sweeper) | pnpm monorepo | Node | tsc | lwd (sweeper) | vitest, **compose, no CI** | pnpm |
| **qhook** | Outbound webhook delivery | TS | lib+daemon | pnpm monorepo | Node | tsc | lwd | vitest, CI | pnpm |
| **qport** | CSV import/export | TS | lib+daemon | pnpm monorepo | Node | tsc | lwd | vitest, **compose, no CI** | pnpm |
| **qgate** | Entitlements (feature access + limits) | TS | pure lib (+example) | pnpm monorepo | Node | tsc | n/a (lib) | vitest, CI | pnpm |
| **qseek** | Workspace search + indexing | TS | lib (+example, +events-consumer) | pnpm monorepo | Node | tsc | via eventd | vitest, CI | pnpm |
| **qmetric** | Event-derived analytics (`@obh/analytics`) | TS | lib+daemon | pnpm monorepo | Node | tsc | lwd | vitest, **compose, no CI** | pnpm |

**Noteworthy, workspace-wide:**
- The 12 qtools are **not** in one monorepo — they are **12 independent pnpm monorepos**, each publishing `@obh/<name>` + (usually) an `apps/<name>d` worker. Integration is by **database convention** (shared `platform.*` Postgres schema), never by package dependency.
- `lwd` is the odd one out (Go), and it's the *substrate* — everything else deploys onto it.
- qMechanic is the only "product," and it's mid-migration: **legacy** (vanilla HTML) → **admin/backend/mobile**, and **Vercel** → **lwd**, simultaneously.

---

# 2. Existing engineering conventions

## Strong conventions (reliable, repeatable, worth codifying)

- **qtool package template.** Byte-identical `tsconfig.base.json` (`CommonJS`, `ES2022`, `strict`, `declaration`+`declarationMap`+`sourceMap`, `types:["node"]`) across all 12. Root `package.json` is always `private`, pins `packageManager`, `engines.node>=20`, and fans out with `pnpm -r {build,typecheck,test}`. `pnpm-workspace.yaml` is always `packages/*` + `apps/*`. Package `main`→`dist/index.js`, `types`→`dist/index.d.ts`, `files:["dist","src/migrations"]`, **no `exports` map, no ESM**.
- **Public-API grammar.** `defineX` (registry entry) + `createXClient` (producer/reader) + `createXWorker` (consumer), with a shared tail of `pgAdapter`, `createLogger`, `newId`, `runMigrations/migrations/INIT_SQL`, `computeBackoffMs/DEFAULT_BACKOFF`. `index.ts` always opens with a "keep this small and boring" comment. This is an *excellent*, learnable convention.
- **Postgres-native, framework-agnostic core.** Every qtool takes a structurally-typed `pgAdapter(pool)` — the core never build-depends on `pg`. Emit-inside-caller's-transaction, `for-update-skip-locked` claim loops, exponential backoff + jitter, dead-letter after `maxAttempts`, at-least-once + idempotency keys. This worker pattern is genuinely uniform.
- **The `platform.*` schema.** Every tool namespaces its tables under `platform.` and each migration starts `create schema if not exists platform`. **This is the real integration contract** binding the fleet.
- **Standalone-with-seams (Option A/B).** No qtool hard-depends on `@obh/events`. Event-consuming tools (qnotify, qaudit, qmetric, qhook, qseek) expose a `createEventIntake` seam or read `platform.event_deliveries` directly. Excellent decoupling.
- **lwd manifest shape.** `lwd.toml` per app: `name`/`domain`/`port`/`secrets` (names only) + `[git]`+`[build]`+`[health]` + `[[services]]` for backing Postgres. Consistent between qMechanic's two apps and the lwd examples.

## Weak conventions (present but partial or drifting)

- **CI.** Only ~half the qtools have a CI workflow. 5 (qnotify, qaudit, qkeys, qport, qmetric) ship a docker-compose for local integration but **no CI at all**; only qstore has both. The canonical `ci.yml` (postgres:16 service, `DATABASE_URL` gate, `pnpm install --no-frozen-lockfile → build → test`) exists and is good — it's just not universally applied.
- **zod.** Intended as a `peerDependency ^3.23.0`, but only 5/12 declare it; the other 7 validate without it. qMechanic's backend uses **zod v4** — a version fork from the platform's v3.
- **Worker daemon vs example app.** 8 tools ship a real `apps/*d` worker (`bin` + `start`); 4 are pure libs with an example app. **qseek's `searchd` is misleadingly named** — it's an example, not a daemon (qsettings/qgate honestly use `-app`).
- **Logging & config in qMechanic.** `console.*` everywhere; no structured logger; hardcoded `config.ts` (labour rate, company IBAN in source); runtime config in a `GlobalOption` key/value table.

## Inconsistencies (actively contradictory — fix these)

1. **Module system split.** qtools are **CommonJS** (`module: commonjs`, ES2022). qMechanic is **ESM** (`module: ESNext`, `type: module` in admin). A product consuming `@obh/*` today straddles both — it works via `esModuleInterop`, but it's a latent friction the generator must pin deliberately.
2. **Forked kernel code.** `logger.ts` and `adapters/pg.ts` have **already split into two lineages**: qevents has the *older* logger (no `child()`); qjobs/qkeys have the newer one with structured child loggers. qkeys rewrote `pgAdapter` from `any[]` to `unknown[]`. The canonical repo is now *behind* its own descendants. This is the single strongest signal for a shared kernel (§10).
3. **Dual deployment target.** qMechanic deploys to **both** Vercel (serverless: `vercel.json` crons, `@vercel/blob`, `@vercel/analytics`, Neon, `if (!process.env.VERCEL)` branches) **and** lwd (`lwd.toml` + Dockerfile + PM2). Two runtimes, two file-storage backends, two cron mechanisms, in one codebase.
4. **`synchronize: true` in production.** TypeORM auto-generates the schema from 24 entities at boot. `migrations: []` is empty; the one hand-written `001_initial_schema.sql` is drift-prone dead documentation. This directly contradicts the qtools' disciplined `runMigrations` convention.
5. **Naming drift** (see Preamble): repo↔package mismatch on 7/12 tools; product prefix `q` vs vendor scope `obh` vs prompt's `@q/`.
6. **Backend package name is still `resourceguard`** — a stale identity, not `@qmechanic/backend`.
7. **Secrets hygiene.** `JWT_SECRET` defaults to `'your-secret-key'`; wide-open `cors()`; company IBAN literal in source.

---

# 3. qMechanic architectural review (case study)

## What is good

- **Clean domain-route layout** in the backend: `src/routes/<domain>/index.ts` each exporting an Express `Router`, mounted explicitly in `server.ts`, with public routes before `app.use(auth)` and per-resource `middleware/check*.ts` loaders. This is boring and readable — the good kind.
- **Feature-grouped frontend**: `pages/<feature>/`, `components/{common,jobs,vehicles}`, `context/` for cross-cutting state. `ProtectedRoute`, `AuthContext`, `ThemeContext` are conventional and clear.
- **MCP + AI as first-class**: `src/mcp/tools/*` (11 modules) exposed over Streamable HTTP and bridged into an AI chat via the `ai` SDK. This is ahead of the curve and worth *keeping product-side*, not platformizing yet.
- **lwd.toml already present** on both deployable apps — the product is already lwd-aware.

## What is inconsistent

- **`synchronize:true`** vs the empty migration runner (schema governance is absent).
- **The 3,200-line `apiClient.ts`** full of defensive `normalizeX`/`ensureNumber`/`coerceDate` helpers. This is a *symptom*: there is **no shared types package** between `backend` and `admin`, so the frontend defends against its own backend's contract at runtime. `packages/*` is empty; `Vehicle`/`Person` are redefined in the client.
- **Dual runtime** (Vercel + lwd) with `VERCEL`-branching throughout.
- **Two file backends** (Vercel Blob + local `/app/uploads`), **two cron mechanisms** (Vercel cron + in-process `cron-parser`), **two analytics** (Vercel + PostHog).

## What naturally wants extracting

- **A shared `@qmechanic/sdk` package** (types + typed API client) — kills the defensive `apiClient.ts` and the duplicated `API.js`/`gatekeeper.ts`/`analytics.ts` across `admin` and `mobile`. This is the highest-value local extraction and needs no platform package.
- **The whole notification/cron/webhook/upload/report cluster** → the qtools (mapped below).

## What should remain product-specific (never platformize)

- Job cards, inspections, defects, parts, timesheets, holidays, `VehicleEvent` compliance chaining — this is the *business*.
- The **MCP tools + AI chat + Azure invoice OCR** — product differentiation, not platform.
- Auth/JWT/`Person` model — user identity is product-owned (qkeys is *machine* keys, not human auth; there is no `@obh/auth` and there shouldn't be a rushed one).

## What should never become platform code

- The `GlobalOption` catch-all table pattern (replace it, don't enshrine it).
- Anything Vercel-specific (`@vercel/blob`, Vercel cron) — that's the runtime being *migrated away from*.
- The defensive normalization layer — that's a bug-smell, not a reusable asset.

## The 12 primitives mapped against qMechanic

| Primitive | Where it integrates in qMechanic | Current state | Fit |
|---|---|---|---|
| **Events** (`@obh/events`) | Emit `job.created`, `inspection.completed`, `vehicle_event.expiring`, `timesheet.submitted` inside existing route transactions. **NB:** qMechanic's `VehicleEvent` is a *compliance record*, **not** a domain event — it is a false friend; there is no event bus today. | **Greenfield** | Clean slot; enables everything below to be event-driven instead of DB-polled. |
| **Jobs** (`@obh/jobs`) | Replace `routes/cron/notifications.ts` (`cron-parser` + "fired in last 60s") and the raw `worker_threads` report generation. | Two hand-rolled mechanisms | Strong — removes Vercel cron dependency. |
| **Notifications** (`@obh/notifications`) | `NotificationConfig`/`NotificationLog` + `pushService` (Expo). **Gap: qMechanic is push-only; `@obh/notifications` is email-only v1** — needs a push channel added to the package. | Homegrown, push-only | Partial — package must grow a push provider. |
| **Files** (`@obh/files`) | `utils/storage.ts` (Vercel Blob) + `multer` + `JobCardFile` entity + baked `/app/uploads`. | Two backends | Strong — collapses to one `file_id` abstraction over S3/MinIO. |
| **Audit** (`@obh/audit`) | The `audit_log` table exists in `001_initial_schema.sql` **but is never created** (no entity, `synchronize` skips it). Today "audit" = a `createdBy` FK. | **Aspirational/greenfield** | Cleanest possible slot — derive from events. |
| **Settings** (`@obh/settings`) | `GlobalOption` key/value table (labour rate, logo, support webhook creds, permissions). | Untyped catch-all | Strong — typed/scoped replacement. |
| **API Keys** (`@obh/api-keys`) | None today (only human JWT). Needed for the MCP endpoint and future integrations. | None | Additive — good fit for machine access to `/mcp`. |
| **Webhooks** (`@obh/webhooks`) | `routes/support.ts` (outbound to issue tracker, URL+token in `GlobalOption`, unsigned). | Homegrown, unsigned | Strong — adds HMAC signing + retries. |
| **Import/Export** (`@obh/import-export`) | `csv-stringify`/`csv-writer` across all report routes + timesheets; `pdfkit`. Invoice parser ingests. | Direct lib use | Good for CSV import; PDF/report export stays product-side or a thin export def. |
| **Entitlements** (`@obh/entitlements`) | `lib/gatekeeper.ts` — a full seat/license client, **currently disabled** (`isGatekeeperConfigured()` short-circuits true). **NB:** gatekeeper is *seat/billing*-shaped; qgate is *workspace-capability*-shaped — overlapping but not identical. | Neutered existing client | The single best retrofit anchor — but reconcile the seat-vs-capability model. |
| **Search** (`@obh/search`) | None — list endpoints use `ILIKE`/QueryBuilder + client-side normalization. | None | Additive — index jobs/vehicles/people. |
| **Analytics** (`@obh/analytics`) | Vercel Analytics + PostHog + a custom `trackApiCall`. | Two external SaaS | Medium — self-hosted, event-derived KPIs; product may keep PostHog for product analytics. |

**Verdict:** qMechanic is an unusually clean retrofit target because so many primitives are either *greenfield* (events, audit, search, api-keys) or *already isolated behind a seam* (gatekeeper, storage.ts, pushService, support.ts). The migration is *addition and substitution*, not surgery.

---

# 4. qtools review

Grammar recap: `defineX` + `createXClient` + `createXWorker` + shared tail (`pgAdapter`, `createLogger`, `newId`, `runMigrations`, `computeBackoffMs`).

| Tool | Purpose | Responsibility boundary | Deps | Public API (core) | Unix? | Overlap | Improve |
|---|---|---|---|---|---|---|---|
| **@obh/events** | Outbox + fan-out dispatch + delivery | Reliable at-least-once delivery of facts; **not** streaming/Kafka | pg (peer-struct), zod (peer) | `defineEvent`, `createEventRegistry`, `createEventClient`, `createEventDispatcher`, `createConsumerRunner` | ✅ | — (it's the hub) | Dispatcher/runner split is inconsistent with `createXWorker` grammar — consider a `createEventWorker` façade. |
| **@obh/jobs** | Command queue + worker | Background/scheduled *commands* (snake_case); idempotent handlers | pg, zod (peer) | `defineJob`, `createJobRegistry`, `createJobClient`, `createWorker` | ✅ | Slight w/ events (jobs=commands, events=facts — kept distinct, good) | `createWorker` should be `createJobWorker` for grammar consistency. |
| **@obh/notifications** | Events → delivered email | Templating + delivery + dedup | pg, nodemailer (lazy) | `defineTemplate`, `defineNotificationRule`, `createNotificationClient`, `createNotificationWorker`, `createEventIntake`, `smtpProvider`/`memoryProvider` | ✅ | — | **Add a push channel** (qMechanic needs Expo push). No CI. |
| **@obh/files** | Metadata + signed URLs over S3 | File lifecycle by `file_id`; never proxies bytes | pg, AWS SDK v3 (dep) | `createFilesClient`, `createS3StorageProvider`, `createMemoryStorageProvider` | ✅ | — | Pure lib but carries a heavy AWS dep — fine; keep provider swappable. |
| **@obh/audit** | Immutable who-did-what | Append-only trail derived from events; DB-enforced immutability | pg | `defineAuditRule`, `createAuditClient`, `createAuditWorker`, `createEventIntake` | ✅ | Reads `event_deliveries` like analytics/search — shared pattern, not overlap | No CI. |
| **@obh/settings** | Typed scoped config | Define/resolve/override/audit settings; **not** RBAC | pg, zod (peer) | `defineSetting`, `createSettingsRegistry`, `createSettingsClient` | ✅ | Overlaps **entitlements** conceptually (setting=behaviour vs entitlement=access) — boundary documented, keep separate | Pure lib. Good. |
| **@obh/api-keys** | Machine M2M credentials | Create/auth/scope/rotate keys; **not** OAuth/human auth | pg, node:crypto | `createApiKeysClient`, `authenticateRequest`, `requireScopeOrThrow`, `generateKey/parseKey` | ✅ | — | Only tool with a 2nd pkg (`@obh/api-keys-hono`). No CI. |
| **@obh/webhooks** | Outbound signed delivery | Subscribe→sign→POST→retry; outbound only | pg, node:crypto+fetch | `createWebhooksClient`, `createWebhooksWorker`, `defineWebhookConsumer` | ✅ | It's an events *consumer* (like notify) — pattern, not overlap | — |
| **@obh/import-export** | CSV in/out via ports | Parse→map→validate→commit; export | pg, zod (peer) | `defineImport/defineExport`, `createImportExportClient`, `createImportWorker`+`createExportWorker` | ✅ | Uses **files** (FileStore port) + **jobs** (handlers) + **events** (EventSink) — by port, not dep | No CI. |
| **@obh/entitlements** | Feature access + limits | has/get/limit/require; **not** RBAC/billing | pg | `defineEntitlement`, `createEntitlementRegistry`, `createEntitlementsClient` | ✅ | vs settings (documented) | Pure lib. No zod despite validation needs. |
| **@obh/search** | Index → query workspace | FTS+trigram behind `SearchProvider`; **not** RBAC | pg (pg_trgm) | `defineSearchEntity`, `createSearchClient`, `createPostgresSearchProvider`, `createSearchWorker` | ✅ | events consumer pattern | `searchd` is an example, not a daemon — rename to `search-app`. |
| **@obh/analytics** (qmetric) | Events → KPIs | facts→rollups→query; derived, rebuildable | pg | `createAnalyticsClient`, `createAnalyticsWorker`, `createEventIntake`, `query/timeseries/breakdown/top` | ✅ | events consumer pattern | No CI. |

**Every tool satisfies the Unix test.** No tool owns RBAC; each does one thing. The only genuine *conceptual* adjacency (settings vs entitlements) is explicitly documented and correctly kept apart.

## Dependency graph

At the **package** level, the graph is almost empty — that's the design win:

```
                        (no @obh package depends on another @obh package,
                         except @obh/api-keys-hono ─workspace:*─▶ @obh/api-keys)

Integration is by DATABASE, not by import:

   ┌─────────────────────────── platform.* (one Postgres schema) ───────────────────────────┐
   │                                                                                          │
   │   @obh/events ── writes ─▶ platform.events / platform.event_deliveries                   │
   │        ▲                                   │                                             │
   │        │ emit()                            │ read consumer="notifications"/"audit"/...   │
   │   (product code)                           ▼                                             │
   │                         ┌──────────────┬──────────────┬──────────────┬──────────────┐   │
   │   consumers (Option A/B via createEventIntake):                                      │   │
   │      @obh/notifications  @obh/audit   @obh/analytics  @obh/search   @obh/webhooks     │   │
   │                                                                                       │   │
   │   standalone libs (product calls directly, may emit events best-effort):              │   │
   │      @obh/settings   @obh/entitlements   @obh/api-keys   @obh/files                    │   │
   │                                                                                       │   │
   │   @obh/import-export ── ports ─▶ FileStore(@obh/files) + Jobs(@obh/jobs) + EventSink   │   │
   │   @obh/jobs ◀── events usually trigger jobs (no build-time dep) ── @obh/events         │   │
   └───────────────────────────────────────────────────────────────────────────────────────┘

   Duplicated (not shared) across ALL 12:  pgAdapter · logger · ids · backoff · migrations · db-types
                                            └────────── candidate: @obh/kernel (§10) ──────────┘
```

**Boundary improvements:**
- Extract the duplicated plumbing into `@obh/kernel` (§10) — the *only* new package edge worth adding, and it heals real drift.
- Standardize the event-consumer seam: all of notify/audit/analytics/search/webhooks reinvent `createEventIntake`/`event_deliveries` reading. Move that seam into the kernel too.
- Nothing "belongs elsewhere" — boundaries are unusually clean. The work is *deduplication of plumbing*, not *re-drawing of responsibilities*.

---

# 5. lwd review

**Model (from `docs/VISION.md` + `internal/spec/spec.go`):** three primitives — **Surfaces** (stateless: APIs, sites, workers — scaled/moved/blue-green/rolled-back), **Resources** (stateful: DBs/volumes — never blue-green, fail over via driver), **Nodes** (dumb compute). The controller owns desired state, off the request path.

**The `lwd.toml` manifest — every field that exists** (authoritative from `spec.go`):

- Top-level: `name` (required, regex-checked), `image` **xor** `[git]` **xor** `compose` (three mutually-exclusive shapes), `domain`, `port` (container port), `node`/`pool` (placement), `env` (map), `secrets` (**names only**), `replicas` (1–50), `[requirements]` (`cpu` cores, `memory` size), `[health]` (`path`, `timeout`).
- `[git]`: `url`, `ref` (default `main`), `path` (subdir).
- `[build]`: `dockerfile`, `context` — **only valid with `[git]`**; Dockerfile builds only (no buildpacks).
- `[[services]]` (backing/stateful): `name`, `image`, `command`, `env`, `secrets`, `volume` (`"name:path"`). **No port** — internal-only, reached by service name on a per-app `lwd-<app>` network.

**Hard constraints a generator MUST respect:**
1. **There is no worker or cron type.** A background worker is *another surface app* — and image/git apps **require `domain` + `port`**, so even a worker needs a (possibly internal) domain and a health port.
2. **`replicas > 1` is rejected alongside `[[services]]` or `compose`.** You cannot both co-locate a Postgres and scale the app.
3. **Backing services publish no host ports** and live on an isolated per-app network — **cross-app DB reachability is a real problem** (a separate worker app cannot trivially reach another app's `[[services]]` Postgres).
4. Secrets are **names only**; values set out-of-band via `lwd secret set <app> <KEY>`; deploys **fail closed** on any unset secret.
5. Never emit `surfaces` (parsed but always rejected).

**Platform behaviors** (grounded): Caddy router (`internal/router`) fronts one `lwd-caddy` container, generates a Caddyfile, atomic `/load`, automatic TLS, round-robin over replicas with passive health. Blue-green via `reconciler` (stage → health-gate → flip route). Placement via `internal/scheduler` (`Place()` filters by pool + fits `[requirements]`, ranks by free memory→CPU). Self-healing reconcile loop + node failover (`EvacuateNode`, `LWD_FAILOVER_GRACE`). Backing services from `[[services]]` rendered to a generated compose (`reconciler/backing.go`) with named volumes, run pinned, never moved. Deploy via `lwd apply [dir]` (unix socket) or git-clone-and-build; also `lwd-web` modal and `lwd-mcp` tools.

**Backing-service presets** (client-side UX in lwd-web, not a runtime feature): `postgres:16`, `mariadb:11`, `redis:7`, `valkey:8`, `minio`, `mongo:7` — each prefills image/volume/env/secret-keys.

## How new projects should generate lwd manifests

The generator's manifest emitter must encode the constraints above. The **recommended topology** for a standard SaaS (web/API + worker + Postgres) given lwd's per-app network isolation and the replicas-vs-backing rule:

**Option A (default — co-locate via compose, one deployable unit):** emit a `compose=` app so web + worker + Postgres share one network; simplest, but no per-surface blue-green/scaling. Good for small products.

**Option B (recommended for growth — split, DB as its own app):** three manifests:

```toml
# deploy/api.lwd.toml — the web/API surface (scalable)
name    = "myapp-api"
domain  = "api.myapp.com"
port    = 8080
env     = { NODE_ENV = "production", LOG_LEVEL = "info" }
secrets = ["DATABASE_URL", "SESSION_SECRET"]
replicas = 2
[git]   { url = "https://github.com/acme/myapp", ref = "main", path = "apps/api" }
[build] { dockerfile = "Dockerfile" }
[health]{ path = "/healthz", timeout = "30s" }
```
```toml
# deploy/worker.lwd.toml — the background worker (its own surface)
name    = "myapp-worker"
domain  = "worker.internal.myapp.com"   # required even for a worker
port    = 8080                            # health port
env     = { ROLE = "worker" }
secrets = ["DATABASE_URL"]
[git]   { url = "https://github.com/acme/myapp", ref = "main", path = "apps/worker" }
[build] { dockerfile = "Dockerfile" }
[health]{ path = "/healthz" }
```
```toml
# deploy/db.lwd.toml — Postgres as a dedicated app (so api can scale)
name    = "myapp-db"
image   = "postgres:16"           # (image app; note backing-vs-replicas rule)
port    = 5432
env     = { POSTGRES_DB = "myapp", POSTGRES_USER = "myapp" }
secrets = ["POSTGRES_PASSWORD"]
```

Because a scalable API (`replicas>1`) **cannot** carry a `[[services]]` Postgres, and a separate worker app **cannot** reach another app's isolated backing network, the generator should **default to Option A (compose) for `--size small`** and **Option B for `--size scale`**, and explicitly document the cross-network reachability caveat. This is the most important lwd-specific decision the generator encodes — and it's exactly what qMechanic hit (it put Postgres as a `[[services]]` under the API and cannot yet scale that API).

I'd wire the emitter through the existing **`lwd-toml` skill** so generated manifests stay validated against `spec.go` as the schema evolves.

---

# 6. Project taxonomy

The types you actually build (evidence in parentheses):

| Type | Evidence | Expected structure | Generated services | Runtime | Key deps | Deployment |
|---|---|---|---|---|---|---|
| **Platform package** (qtool) | all 12 | `packages/<name>/src/{index,adapters/pg,logger,ids,backoff,migrations,migrations/*.sql,__tests__}` + optional `apps/<name>d` | none / worker daemon | Node ≥20 | `@obh/kernel`, pg, (zod peer) | lib → npm; daemon → lwd |
| **Backend API** | qMechanic/backend | `src/{server,config,data-source,routes/<domain>/index,middleware/check*,entities}` | Postgres | Node + PM2 | express, typeorm/pg, `@obh/*` | lwd git app + `[[services]]` db |
| **Worker** | eventd/workerd/notifyd… | `src/{main,config,health,migrate}` + consumers/handlers | — | Node | `@obh/<tool>`, pg | lwd surface app (domain+health) |
| **Admin frontend** | qMechanic/admin | Vite React PWA: `src/{pages,components/{common,…},context,lib,styles}` | — | nginx (static) | react, react-router-dom v7, `@qmechanic/sdk` | lwd nginx image, `VITE_*` baked at build |
| **Marketing/public frontend** | (implied by lwd web presets) | Vite/Astro static | — | nginx | — | lwd static |
| **Mobile app** | qMechanic/mobile | Expo: `App.tsx`, `src/{components,features,lib/{analytics,apiClient}}`, `android/` | — | RN/Expo | expo, react-navigation, posthog | EAS → stores (not lwd) |
| **Shared SDK** | **missing** in qMechanic (the gap) | `packages/sdk/src/{types,client}` | — | isomorphic | — | consumed by admin+mobile+backend |
| **Shared UI** | partially (`components/common`) | `packages/ui` | — | React | — | consumed by frontends |
| **CLI** | lwd, and `create-q-app` itself | `bin/`, `src/commands/*` | — | Node | — | npm |
| **Full SaaS** | qMechanic | `apps/{api,admin,mobile}` + `packages/{sdk,ui,config}` + `deploy/*.lwd.toml` | Postgres + selected qtools | mixed | `@obh/*` | lwd (multi-app) |

The two types **you build but don't yet scaffold well**: the **shared SDK** (the missing `packages/` that would delete the 3,200-line defensive client) and the **worker as a proper deployable** (lwd has no worker type, so you improvise).

---

# 7. Proposed workspace standard

Based on the evidence (qMechanic's empty `packages/`, the duplicated client code, the missing SDK, the ad-hoc `deploy` story), here is the standard `create-q-app` should generate. It generalizes qMechanic's *good* layout and fills its gaps:

```
myapp/
├─ apps/
│  ├─ api/            # Express + pg backend (routes/<domain>/index.ts, middleware/check*)
│  ├─ admin/          # Vite React PWA (pages/, components/{common}, context/, lib/)
│  ├─ worker/         # lwd surface worker: wires @obh/*d consumers/handlers
│  └─ mobile/         # (optional) Expo
├─ packages/
│  ├─ sdk/            # ★ typed API client + shared types (backend↔frontend contract)
│  ├─ ui/             # (optional) shared React components extracted from components/common
│  └─ config/         # shared tsconfig, eslint, prettier (the one place they live)
├─ deploy/
│  ├─ api.lwd.toml
│  ├─ worker.lwd.toml
│  └─ db.lwd.toml     # (or compose.lwd.toml for --size small)
├─ docker/
│  ├─ api.Dockerfile
│  └─ admin.Dockerfile   # multi-stage node→nginx, VITE_* build ARGs
├─ migrations/        # product migrations, run by a real runner (NOT synchronize:true)
├─ scripts/           # migrate.ts, seed.ts, dev.ts
├─ .github/workflows/ci.yml   # the canonical postgres:16 CI, applied to EVERY project
├─ pnpm-workspace.yaml        # packages/* apps/*
├─ tsconfig.base.json         # ONE decision on module system (see below)
├─ package.json               # pnpm -r fan-out
├─ AGENTS.md / CLAUDE.md
└─ README.md
```

**Deliberate deviations from what exists today:**
- **`packages/sdk` is mandatory** for any project with a frontend — it's the missing piece that caused qMechanic's biggest wart.
- **`deploy/` holds all lwd manifests** (qMechanic scatters `lwd.toml` per-app; centralizing makes the multi-app topology legible and lets the generator own it).
- **`migrations/` + a real runner** — never `synchronize:true`.
- **Pin one module system.** Recommendation: generate **ESM** app-side (`module: NodeNext`), consume the CommonJS `@obh/*` packages via `esModuleInterop` (already works). Keep the qtools CJS for now; the kernel extraction (§10) is the moment to consider a dual-build. State the choice explicitly in `tsconfig.base.json`.
- **`packages/config`** centralizes tsconfig/eslint/prettier so the template doesn't drift the way the qtool CI did.

---

# 8. `create-q-app`

A thin, boring scaffolder. **Unix-philosophy CLI**: it writes files and stops — no runtime, no framework, no lock-in. Everything it generates is plain TypeScript the developer can read and delete.

## Questions the wizard asks (only where genuine product variation exists)

1. **App name** → `myapp` (drives package names, `deploy/*` names, domains).
2. **Namespace / npm scope** → default `@<name>` for product-local packages (`@myapp/sdk`); platform packages are always `@obh/*`.
3. **Project type** → `full-saas` | `backend-only` | `frontend-only` | `worker` | `platform-package` | `cli`.
4. **Frontends** → count + kind (`admin`, `public`) — default 1 admin.
5. **Mobile?** → yes/no (Expo).
6. **Database** → `postgres` (default; the only first-class option — everything platform assumes pg) | `none`.
7. **Auth** → `jwt` (default, matches qMechanic) | `none` | `api-keys-only`.
8. **Platform primitives** → multiselect, **all off by default** (opt-in): events, jobs, notifications, files, audit, settings, api-keys, webhooks, import-export, entitlements, search, analytics.
9. **Deployment size** → `small` (compose: web+worker+db one unit) | `scale` (split apps, dedicated db) — drives the lwd topology from §5.
10. **Domain(s)** → base domain (`myapp.com`) → derives `api.`, `app.`, `worker.internal.`.
11. **Testing** → `vitest` (default) yes/no.
12. **Docs** → generate `AGENTS.md`/`CLAUDE.md` + `README` yes/no (default yes).

Everything else is convention: pnpm, CommonJS-vs-ESM decision, CI workflow, `packages/config`, folder layout, the `check*` middleware pattern, `routes/<domain>/index.ts`.

## Generated directories & files

- **`apps/api/`**: `src/server.ts` (express, cors from env allowlist — **not** `cors()` open, `app.use(auth)` boundary), `src/config.ts` (env-driven, **no hardcoded secrets**), `src/db.ts` (pg Pool + `pgAdapter` from `@obh/kernel`), `src/routes/health/index.ts`, `src/routes/<domain>/index.ts` stub, `src/middleware/{auth,check*}.ts`, `Dockerfile` (multi-stage node:20-alpine, **not** PM2 unless `--pm2`).
- **`apps/admin/`**: Vite React PWA, `src/main.tsx`, `App.tsx` with `ProtectedRoute`, `context/{AuthContext,ThemeContext}.tsx`, `lib/apiClient.ts` **generated from `@myapp/sdk`** (thin, no defensive normalization), `docker/admin.Dockerfile` (node→nginx, `VITE_*` ARGs).
- **`apps/worker/`**: `src/main.ts` (the eventd-style tick loop + graceful shutdown, copied from the canonical `apps/eventd/src/main.ts`), `src/health.ts`, `src/config.ts`, `src/consumers.ts` / `src/handlers.ts` wiring only the selected `@obh/*d` tools.
- **`packages/sdk/`**: `src/types.ts` (shared domain types), `src/client.ts` (typed fetch client), `index.ts`. The contract that makes the defensive client unnecessary.
- **`packages/config/`**: `tsconfig.base.json`, `eslint.config.js`, `prettier` config.
- **`deploy/`**: the `.lwd.toml` files per §5, matching `--size`.
- **`migrations/`**: `0001_init.sql` + `scripts/migrate.ts` (a real runner, `runMigrations` pattern from the kernel).
- **`.github/workflows/ci.yml`**: the canonical postgres:16 workflow — **applied to every project** (fixes the half-the-fleet-has-no-CI gap).
- **Root**: `pnpm-workspace.yaml`, `package.json` (`pnpm -r` fan-out), `tsconfig.base.json`, `README.md`, `AGENTS.md`.

## Generated scripts (root `package.json`)

- `dev` → `pnpm -r --parallel --filter './apps/*' dev`
- `build` → `pnpm -r build`
- `typecheck` / `lint` / `format` / `test` → recursive fan-out (the qtool convention)
- `migrate` → `tsx scripts/migrate.ts`
- `deploy` → `lwd apply deploy/api.lwd.toml && lwd apply deploy/worker.lwd.toml && …` (or a single compose apply for `--size small`)

---

# 9. Platform wiring

For each selected primitive, `create-q-app` wires exactly five things. All wiring is **opt-in and additive** — deselecting a primitive generates zero references to it.

| Primitive | Migration | Worker | Env vars | Example usage generated | Optional feature |
|---|---|---|---|---|---|
| **events** | `@obh/events` `runMigrations` (creates `platform.events`, `event_deliveries`) | `apps/worker` runs `createEventDispatcher` + `createConsumerRunner` | `DATABASE_URL` | `emit('job.created', …)` inside an api route tx | — |
| **jobs** | `platform.jobs` | worker runs `createWorker` | `DATABASE_URL` | `defineJob('send_report')` + `enqueue()` in a route | idempotency-key dedup example |
| **notifications** | 4 tables | `createNotificationWorker` in worker | `SMTP_URL` (+ future `EXPO_*`) | `defineTemplate` + `defineNotificationRule` reacting to `job.created` | push channel (if mobile selected) |
| **files** | `platform.files`, `file_attachments` | none (pure client) | `S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY`/`SECRET` (or MinIO backing) | `createUpload()`→signed PUT in a route; `attach()` | MinIO `[[services]]` in dev compose |
| **audit** | `audit_entries`, `audit_redactions` (immutable triggers) | `createAuditWorker` (events consumer) | `DATABASE_URL` | `defineAuditRule` mapping `*.updated` → entry | redaction endpoint |
| **settings** | `platform.settings`, `setting_changes` | none | `DATABASE_URL` | `defineSetting('labour_rate', …)` + `resolve()` | — |
| **api-keys** | `platform.api_keys`, `api_key_usage` | optional `keysd` sweeper | `API_KEYS_PEPPER` (**required**) | `apiKeyAuth()` middleware on `/mcp` or `/api` | hono adapter if hono chosen |
| **webhooks** | 4 `webhook_*` tables | `createWebhooksWorker` | `WEBHOOKS_ENCRYPTION_KEY` | `defineWebhookConsumer` fan-out of events | SSRF guard on by default |
| **import-export** | 3 tables | `createImportWorker`/`createExportWorker` (via jobs) | — | `defineImport('vehicles')` + CSV route | wires FileStore→files, EventSink→events |
| **entitlements** | 4 tables | none | `DATABASE_URL` | `defineEntitlement('max_vehicles', …)` + `require()` in route | plan seeds |
| **search** | `platform.search_documents` (pg_trgm) | `createSearchWorker` (events consumer) | `DATABASE_URL` | `defineSearchEntity('vehicle')` + `query()` | permissionFilter hook |
| **analytics** | 3 tables | `createAnalyticsWorker` (events consumer) | `DATABASE_URL` | `defineMetric` + `timeseries()` | rebuild-from-events script |

**Keeping dependency boundaries clean:**
- **No product code imports another product's internals.** The api emits events; the worker consumes them. The only shared package is `@myapp/sdk` (types/client) — never business logic across app boundaries.
- **Primitives couple to the DB (`platform.*`), not to each other.** The generator wires the *seams* (`EventSink`, `FileStore`, `RecipientResolver`, `permissionFilter`) with product closures, never by importing product models into a package.
- **All `@obh/*` deps are direct in the app that uses them**, transitively pulling only `@obh/kernel`. No meta-package.
- **Env is the only global.** Each primitive declares its env in `deploy/*.lwd.toml` `secrets` (names) and `.env.example` (documented). One `DATABASE_URL` shared; per-tool secrets namespaced.

---

# 10. Kernel / Rollup

**Decision: build `@obh/kernel`. Do NOT build a runtime rollup/stack/god-package.**

## Why a kernel (strong evidence)

The audit found the plumbing is **already forking**:
- `logger.ts` exists in **two lineages** — qevents has the old one (no `child()`); qjobs/qkeys have the newer structured-child version. *The canonical repo is behind its descendants.*
- `adapters/pg.ts` forked — qkeys rewrote `any[]`→`unknown[]` and changed the `release` signature.
- `ids.ts`, `backoff.ts`, `db.ts`, `migrations.ts` are copied byte-for-byte into all 12.

This is exactly the drift a kernel prevents. Twelve copies of the same 200 lines, already diverging, is a maintenance liability that compounds every time you add a 13th tool.

## What belongs in `@obh/kernel`

Pure, boring, product-agnostic plumbing only:
- `pgAdapter` + the `Db`/`TransactionalDb`/`QueryResult` structural types (unify the two lineages on the `unknown[]` variant).
- `createLogger` + `Logger`/`LogLevel`/`LogFields` (adopt the newer `child()` version).
- `newId(prefix)`.
- `computeBackoffMs` + `DEFAULT_BACKOFF`.
- `runMigrations` + `Migration` type + the `platform` schema bootstrap.
- The **event-consumer seam** (`createEventIntake` / `event_deliveries` reader) that notify/audit/analytics/search/webhooks each reinvent.
- The **worker tick-loop harness** (the graceful-shutdown/health/`ticking` guard from `apps/eventd/src/main.ts`, duplicated in every `*d`).

## What explicitly does NOT belong

- **No business logic.** Not events, not jobs — those stay their own packages.
- **No product coupling.** Never imports a product model.
- **No zod.** Validation stays per-package (peer).
- **No config/DI framework.** It's a library of functions, not a runtime.

## Dependency direction

```
@obh/kernel  ◀── @obh/events, @obh/jobs, @obh/notifications, … (all 12 depend on it)
                 ▲
                 └── product apps depend on the qtools, get kernel transitively
```

**Applications depend on the qtools, never on the kernel directly.** The kernel is an implementation detail of the platform packages. `create-q-app` scaffolding references qtools; the kernel is invisible to product authors. It contains **no runtime logic that products invoke** — it wires nothing at the app level; it only supplies plumbing the qtools are built from.

## On the alternatives (`q-rollup` / `q-stack` / `q-kit` / `q-runtime`)

**Reject all runtime rollups.** A `@obh/platform` that re-exports all 12 would violate the opt-in principle (installing one thing pulls everything), contradict the standalone-with-seams design you deliberately built, and re-introduce the framework lock-in you're avoiding. The *only* legitimate "rollup" is **`create-q-app` itself at scaffold-time** — it selects and wires packages, then disappears. That's composition, not a mega-framework. Keep it that way.

---

# 11. Retrofitting qMechanic

A roadmap of small, reversible steps. **No rewrite.** Each step is independently shippable and independently revertable.

**Phase 0 — de-risk (do first, no platform code):**
1. **Kill `synchronize:true`.** Generate a real baseline migration from the current schema, wire a `runMigrations`-style runner, set `synchronize:false`. This is the highest-risk item and blocks nothing else. *Never* change entity semantics in this step.
2. **Fix secrets hygiene:** remove the `'your-secret-key'` JWT default (fail closed), scope `cors()` to an allowlist, move the IBAN out of `config.ts` into `GlobalOption`/env. Compatibility layer: none needed.
3. **Rename `resourceguard` → `@qmechanic/api`** (package.json `name` only).

**Phase 1 — the local SDK (biggest quality win, still no platform):**
4. Create `packages/sdk` with shared types + a thin typed client. Migrate `admin` and `mobile` off the duplicated `API.js`/`apiClient.ts`/`gatekeeper.ts`/`analytics.ts` **one domain at a time**. The 3,200-line defensive client shrinks as the contract firms up. Adapter: keep the old `apiClient.ts` re-exporting from the SDK during migration.

**Phase 2 — greenfield primitives (pure addition, lowest risk):**
5. **`@obh/events`** — run migrations, emit facts inside existing route transactions (`job.created`, `inspection.completed`, `vehicle_event.expiring`). Nothing consumes yet; purely additive.
6. **`@obh/audit`** — the `audit_log` table is already *specified but dead*; wire `@obh/audit` as the events consumer that fills it. This is the cleanest possible retrofit.
7. **`@obh/search`** and **`@obh/analytics`** — additive events consumers; no existing behavior to break.

**Phase 3 — substitutions (behind existing seams):**
8. **`@obh/files`** ← replace `utils/storage.ts` (Vercel Blob) with an S3/MinIO provider. `storage.ts` is already a single choke point — swap its body, keep its signature (adapter). Removes a Vercel dependency.
9. **`@obh/jobs` + `@obh/notifications`** ← replace `routes/cron/notifications.ts`. Move scheduling to `@obh/jobs`, delivery/dedup to `@obh/notifications`. **Blocker to resolve first:** `@obh/notifications` is email-only; qMechanic needs **Expo push** — add a push channel to the package before this step (tracked as a package gap). Compatibility: run both the Vercel cron and the new worker in parallel behind a flag, then cut over.
10. **`@obh/webhooks`** ← replace `routes/support.ts` outbound webhook (gain HMAC signing + retries). Adapter: keep the `/support` route, swap its body.
11. **`@obh/settings`** ← migrate `GlobalOption` entries to typed settings incrementally (both can coexist; read-through the new client, write-through both during transition).
12. **`@obh/import-export`** ← wrap the existing `csv-*` report routes with `defineExport`; keep PDF (`pdfkit`) product-side.

**Phase 4 — entitlements (needs a model decision):**
13. **`@obh/entitlements`** ← the disabled `gatekeeper.ts` is the anchor, but **reconcile the model first**: gatekeeper is *seat/billing*-shaped, qgate is *workspace-capability*-shaped. Decide whether seats map onto entitlement limits or whether billing stays a separate concern. This is design work, not mechanical — do it last.

**Phase 5 — runtime consolidation:**
14. Retire the **Vercel** target once files (Phase 3.8) and cron (3.9) no longer need it; standardize on **lwd** with the `deploy/` topology from §5.

**What should wait:** entitlements model reconciliation (Phase 4), the Vercel→lwd cutover (Phase 5), any mobile rework.

**What should never change:** the domain model (job cards, inspections, defects, parts, timesheets, `VehicleEvent` compliance chaining), the MCP tools + AI chat + Azure OCR, and the human-auth `Person`/JWT layer. These are the product; platform code stays out of them.

---

# 12. Future evolution

Not more primitives — you have the 12 that matter. The next evolution is about **engineering experience, consistency, and the deployment story:**

1. **Ship `@obh/kernel` and `create-q-app` together.** The kernel heals the drift you already have; the generator prevents the *next* drift. This is the single highest-leverage move — it turns "12 hand-kept-consistent repos" into "12 repos that are consistent by construction."

2. **Make consistency mechanical, not manual.** The half-the-fleet-has-no-CI gap, the two logger lineages, the zod-in-5-of-12 — all are symptoms of hand-copied templates. A shared `packages/config` + a `create-q-app --type platform-package` mode that regenerates the qtool skeleton means the template lives in *one* place. Consider a periodic "template drift" check across the `@obh/*` repos.

3. **Close the `@obh/notifications` push gap and the entitlements/seats model.** These are the two places where a real product (qMechanic) exceeds what the platform offers. Let product needs drive package evolution — resist adding primitives nobody's product needs yet.

4. **Adopt lwd as the single runtime and teach the generator its constraints.** The most valuable deployment improvement is encoding the *non-obvious* lwd rules (no worker type → separate app; `replicas>1` excludes backing services; per-app network isolation) into `create-q-app` so no future project rediscovers them the way qMechanic did. Route manifest generation through the `lwd-toml` skill so it tracks `spec.go`. The roadmap resource-drivers (P14/P15 Postgres/Valkey/MinIO with lifecycle + HA) will eventually remove the compose-vs-split tradeoff — design the generator so adopting them is a one-line topology change.

5. **Treat the shared SDK pattern as a first-class project type.** qMechanic's single worst wart (the 3,200-line defensive client) came from *not* having a `packages/sdk`. Every full-SaaS the generator produces should have one from line one. The contract-first discipline it enforces is worth more than any single platform primitive.

6. **Keep the platform boring on purpose.** The reason this audit was *possible* is that the 12 tools genuinely follow Unix philosophy — one thing each, no cross-deps, DB-as-contract, standalone-with-seams. The pressure over years will be to add convenience layers, meta-packages, and magic. The evolution that matters most is the discipline to *not* do that: the platform's job is to disappear into `platform.*` tables and `@obh/*` imports the developer can read and delete.

---

**Bottom line:** You've already built a remarkably coherent platform — 12 Unix-philosophy primitives integrated by a shared Postgres schema, a real deployment substrate in lwd, and a product (qMechanic) whose friction points map almost one-to-one onto the primitives. The two missing pieces are both *consolidation, not expansion*: **`@obh/kernel`** (extract the drifting plumbing) and **`create-q-app`** (make new projects consistent by construction and lwd-aware from birth). Build those two, retrofit qMechanic in the additive order above, and the platform disappears exactly as it should.
