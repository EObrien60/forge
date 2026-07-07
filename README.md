# OBH Forge

Deterministic scaffolding and delivery tooling for OBH software projects.

Forge starts projects correctly, then gets out of the way. It is **not** a
runtime, framework, or reconciler — just a set of composable CLI commands that
generate boring, readable, removable code.

```bash
forge new app qhaul --recipe full-saas       # api + admin + worker + sdk + core primitives
forge add search                             # add a primitive (prerequisites auto-added)
forge add notifications
forge generate lwd                           # (re)generate deploy manifests
forge inspect                                # what's in this project?
forge doctor                                 # does it match OBH conventions?
forge skill install obh-add-events           # drop a Claude skill into .claude/skills/
```

## Install

```bash
pnpm add -g @obh/forge     # once published
# or from source:
pnpm install && pnpm build && node dist/cli.js --help
```

## Commands

| Command | What it does |
|---|---|
| `forge new app <name>` | Scaffold a new project. Recipes: `full-saas`, `api-web-worker`, `api-only`, `worker`. Flags: `--api-framework hono\|express`, `--no-example`, `--no-sdk`, `--mobile [name]`, `--topology compose\|small\|split`, `--repo owner/repo`, `--scope`. |
| `forge new package <name>` | Scaffold an OBH platform-primitive repo (the qtool template: `@obh/<name>`, kernel helpers, record-store client, migrations, CI). `--daemon` adds an admin/worker app. |
| `forge add <target>` | Add an app (`api`/`web`/`worker`/`sdk`/`mobile`) or a primitive — `events`, `jobs`, `files`, `audit`, `settings`, `api-keys`, `webhooks`, `import-export`, `entitlements`, `search`, `analytics`, `notifications`. Prerequisites resolve automatically. |
| `forge inspect` | Report project shape and detected conventions. |
| `forge doctor` | Check the project against OBH conventions (reports only). |
| `forge generate <artifact>` | Regenerate `lwd`, `ci`, or `env`. |
| `forge skill <list\|install>` | List or install the bundled OBH Claude skills. |
| `forge stack <init\|deploy\|status\|rm>` | Deliver the repo to lwd: assemble the apps into one stack, generate + wire secret values, and apply in order. `forge deploy` is an alias for `forge stack deploy`. |

Every mutating command supports `--dry-run`, `--yes`, and `--force`.

## Deploying a stack (`forge stack`)

`forge new` generates per-app `deploy/*.lwd.toml` with **secret names only**.
`forge stack` closes the gap to a running deployment — as a pure client of the
`lwd` CLI (zero lwd changes):

```bash
forge stack init          # inspect deploy/*.lwd.toml → write a reviewable deploy/stack.json
#                           (groups the apps, proposes generated + derived secrets)
# review deploy/stack.json
forge stack deploy         # (alias: forge deploy) generate secret VALUES, wire connections,
#                           lwd secret set + lwd apply each app in dependency order
forge stack status         # rolled-up lwd status across the stack
forge stack rm             # tear down in reverse order (named data volumes preserved)
```

**Default topology is `compose`:** `forge new` bundles **db + api + worker into
one lwd compose app** (shared docker network → the worker reaches Postgres), with
the admin as a separate static app. So `forge deploy` brings the **whole stack up
with one command** and there are no cross-app connectivity gaps. Tradeoff: a
compose app is pinned to one node (no lwd blue-green / per-app replicas for those
services) — `--topology split` emits separate lwd apps for when lwd gains
cross-app networking.

`deploy` **generates** the random secrets (`POSTGRES_PASSWORD`, `JWT_SECRET`,
`API_KEYS_PEPPER`), **derives** connection strings (`DATABASE_URL` from the
Postgres service), **orders** the multi-app apply, and is **idempotent** (lwd is
the sole secret store — already-set secrets are skipped, never rotated silently;
`--dry-run` masks all values). With `--topology split` it **honestly flags** lwd's
per-app network isolation (a worker that can't reach a co-located Postgres),
never wiring a broken value. `--rotate <KEY>` regenerates a secret and re-derives
everything built from it.

## What you get from `forge new`

A real, working vertical slice — not stubs:

- **`apps/api`** — Hono or Express, a Postgres pool with a `withTx` helper, a
  transaction-aware **event bus**, and (unless `--no-example`) a real `notes`
  domain: CRUD over Postgres that emits `note.created/updated/deleted` facts
  inside its write transaction. Routes auto-mount from `src/routes/*`.
- **`apps/admin`** — Vite + React, a real Notes management UI driving the API
  through the shared SDK.
- **`apps/worker`** — a tick loop with a health port that auto-loads consumers
  from `src/consumers.d/*`.
- **`packages/sdk`** — the one typed contract (types + client) shared by the API
  and every frontend.
- **`apps/mobile`** (with `--mobile`) — an Expo React Native app driving the same
  SDK; the notes screen works end-to-end. Ships via EAS, so it gets no lwd
  manifest.
- **`deploy/*.lwd.toml`**, per-app **Dockerfiles**, **CI** (with Postgres),
  a **migration runner**, `.env.example`, `forge.json`.

## How capabilities stay safe

Adding a primitive never patches your code. Generated apps auto-load from
convention directories, so `forge add <x>` just drops files:

- API routes → `apps/api/src/routes/*` (each `register(app)`)
- domain-fact subscribers → `apps/api/src/bus.d/*` (`onEmit(...)`)
- worker consumers → `apps/worker/src/consumers.d/*` (`init`/`tick`)
- platform migrations → `scripts/migrations.d/*` (`migrate(pool)`)

Every change flows through a `Plan` that classifies each op as create / append /
overwrite and refuses to clobber a differing file without `--force`.

Primitives wire into the example domain for real: `events` bridges the bus to the
durable outbox, `jobs` enqueues on note writes, `audit` records `note.*`,
`search`/`analytics` index and roll up note events, `notifications` emails on
`note.created`, `import-export` moves notes as CSV, `entitlements` gates note
creation, `api-keys` protects a machine route.

## Design guarantees

- **Boring, real output.** Generated projects are normal TypeScript you can read,
  edit, or delete. No TODOs, no empty handlers, no placeholder URLs (deploy repos
  are auto-detected from `git remote`, else prompted).
- **Composable & opt-in.** Nothing is installed unless a recipe or `forge add`
  asks for it.
- **Configurable, not rigid.** Framework choice, example on/off, SDK on/off,
  topology, custom app names — all recorded in `forge.json`.
- **lwd-aware.** Manifests encode lwd's real constraints (workers are separate
  surfaces; a scalable API can't co-locate a backing DB; per-app network
  isolation). Secret names only — never values.

## forge.json

Each project carries a `forge.json` recording shape, chosen conventions, and
installed primitives. It's a receipt and an aid for `forge doctor` and the Claude
skills — not a desired-state contract.

## Claude skills

Bundled under `skills/` and installable per-project with `forge skill install`:
`obh-inspect-project`, `obh-add-events`, `obh-retrofit-jobs`, `obh-retrofit-files`,
`obh-generate-audit-rules`, `obh-settings-migration`, `obh-lwd-manifest`,
`obh-sdk-extraction`. Forge does the mechanical file work; the skills do the
interpretive work (reading a repo, proposing event names, mapping legacy code).

## Deferred

AST-level patching and an upgrade/reconcile mode.

## Development

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

Requires Node ≥ 20 and pnpm 9.
