# OBH Forge

Deterministic scaffolding and delivery tooling for OBH software projects.

Forge starts projects correctly, then gets out of the way. It is **not** a
runtime, framework, or reconciler — just a set of composable CLI commands that
generate boring, readable, removable code.

```bash
forge new app qhaul --recipe full-saas
forge add events
forge add jobs
forge add files
forge add audit
forge generate lwd
forge inspect
forge doctor
```

## Install

```bash
pnpm add -g @obh/forge     # once published
# or run from source:
pnpm install && pnpm build && node dist/cli.js --help
```

## Commands (v1)

| Command | What it does |
|---|---|
| `forge new app <name>` | Scaffold a new project (recipes: `full-saas`, `api-web-worker`, `api-only`, `worker`) |
| `forge add <target>` | Add an app (`api`/`web`/`worker`/`sdk`) or a primitive (`events`/`jobs`/`files`/`audit`) |
| `forge inspect` | Report project shape and detected conventions |
| `forge doctor` | Check the project against OBH conventions (reports only) |
| `forge generate <artifact>` | Regenerate an artifact (`lwd`) |

Every mutating command supports `--dry-run`, `--yes`, and `--force`.

## Design guarantees

- **Boring output.** Generated projects are normal TypeScript you can read, edit,
  or delete.
- **Composable.** `forge add events` / `forge add jobs` — no giant combinatorial
  templates.
- **Idempotent & safe.** Commands never silently overwrite. Every change flows
  through a `Plan` that classifies each op as create / append / overwrite, and
  refuses to clobber a differing file without `--force`.
- **Capabilities only create files.** Generated apps auto-load from convention
  directories — API routes from `apps/api/src/routes/*`, worker consumers from
  `apps/worker/src/consumers.d/*`, migrations from `scripts/migrations.d/*` — so
  adding a primitive drops files instead of patching shared code.
- **Opt-in platform.** Nothing is installed unless a recipe or `forge add`
  requests it. Prerequisites (e.g. audit → events) are resolved automatically.
- **lwd-aware.** Generated `deploy/*.lwd.toml` encode lwd's real constraints
  (workers are separate surfaces; a scalable API can't co-locate a backing DB;
  per-app network isolation). Secret names only — never values.

## Project record

Each project carries a `forge.json` recording what was generated (apps, packages,
installed primitives, deploy topology). It is a receipt and an aid for
`forge doctor` and Claude skills — not a desired-state contract.

## What's deferred (post-v1)

Mobile scaffolding; the remaining primitives (settings, api-keys, webhooks,
import-export, entitlements, search, analytics, notifications); AST-level
patching; upgrade/reconcile mode; the Claude skills layer (`obh-inspect-project`,
`obh-add-events`, …). See the spec for the full roadmap.

## Development

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

Requires Node ≥ 20 and pnpm 9.
