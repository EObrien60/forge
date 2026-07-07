# forge stack — repo→lwd delivery layer

**Status:** Design (approved in brainstorming 2026-07-07). New command group in
the existing forge CLI.
**Date:** 2026-07-07

## Problem

forge *scaffolds* a multi-app monorepo (golinks: `apps/{api,admin,worker}`,
`packages/sdk`, `deploy/*.lwd.toml`, `forge.json`) and stops at generating lwd
manifests with **secret names only**. Getting that repo actually running on lwd
is then fully manual, as golinks' own README shows:

```
lwd secret set golinks-api DATABASE_URL JWT_SECRET API_KEYS_PEPPER
lwd secret set golinks-api POSTGRES_PASSWORD
lwd apply deploy/api.lwd.toml
lwd apply deploy/admin.lwd.toml
lwd apply deploy/worker.lwd.toml
```

Nothing groups the three apps as one project, **generates** the secret *values*
(`POSTGRES_PASSWORD`, `JWT_SECRET`, `API_KEYS_PEPPER`), **derives** `DATABASE_URL`
from the Postgres backing service, **propagates** shared secrets consistently, or
**orders** the multi-file apply. This is the "git repo → deployment" experience —
and it must live *above* lwd so lwd stays suckless (lwd gets **zero** changes).

## Non-goals

- **No lwd changes.** The tool is a pure client of lwd's stable CLI.
- **No Vercel-like web UI yet.** CLI-first; the connect-a-repo / click-deploy UI
  is a documented follow-on once this core is proven.
- **No cross-app shared networking, shared-domain path routing, or project-level
  shared secret store.** These are lwd-runtime concerns explicitly deferred.
- **No secret VALUES on disk.** lwd is the sole value store (see Idempotency).
- **Not a reconciler.** `deploy` is an idempotent one-shot, not a control loop.

## Decisions (from brainstorming)

1. **Home:** extend forge (TS/Node CLI) — reuse its `forge.json`/manifest
   parsing, `Plan`/dry-run machinery, logger, prompts, shell.
2. **Wiring config:** an **auto-proposed, reviewable stack manifest** at
   `deploy/stack.json` (beside the lwd manifests; distinct from `forge.json`,
   which stays a receipt). Works with or without `forge.json` — derived
   primarily from the `*.lwd.toml` files, so it also works on non-forge repos.
3. **Wiring depth:** generate secret values + wire **within-app** connections
   fully; **detect lwd's per-app network isolation and flag cross-app gaps**
   rather than emit a broken value.
4. **Interface:** CLI-first.
5. **lwd transport:** the tool shells out to the `lwd` CLI using ambient
   `LWD_DAEMON` / `LWD_API_TOKEN` (works local or remote; no new lwd surface).
6. **`stack rm`:** preserves named data volumes by default; a `--destroy-data`
   flag removes them.

## Commands

New group registered in `src/cli.ts`, `--dry-run/--yes/--force` via the existing
`withFlags`:

| Command | What it does |
|---|---|
| `forge stack init` | Inspect `deploy/*.lwd.toml` (+`forge.json`) → propose and write `deploy/stack.json`. Re-runnable: merges new apps/secrets into an existing manifest without clobbering hand edits (a `Plan` op, honoring `--force`). |
| `forge stack deploy` (alias `forge deploy`) | Read `deploy/stack.json`; resolve + set missing secrets on each app; `lwd apply` every manifest in `order`. `--dry-run` prints the plan, values masked, touching nothing. |
| `forge stack status` | Rolled-up `lwd status` across the group's apps. |
| `forge stack rm` | Tear the group down (`lwd rm` each app in reverse order). Preserves named data volumes unless `--destroy-data`. |

Additional `deploy` flags: `--rotate <KEY>` (regenerate one generated secret and
every connection derived from it), `--app <name>` (limit to one app),
`--no-wait` (don't gate on health between apps).

## The stack manifest — `deploy/stack.json`

The reviewable delivery contract. Example (golinks, small topology):

```json
{
  "name": "golinks",
  "stackVersion": "0.1.0",
  "apps": [
    { "name": "golinks-api",    "manifest": "deploy/api.lwd.toml",    "role": "api" },
    { "name": "golinks-worker", "manifest": "deploy/worker.lwd.toml", "role": "worker" },
    { "name": "golinks-admin",  "manifest": "deploy/admin.lwd.toml",  "role": "web" }
  ],
  "order": ["golinks-api", "golinks-worker", "golinks-admin"],
  "secrets": {
    "generate": {
      "POSTGRES_PASSWORD": { "type": "password", "bytes": 24, "apps": ["golinks-api"] },
      "JWT_SECRET":        { "type": "hex",      "bytes": 32, "apps": ["golinks-api"] },
      "API_KEYS_PEPPER":   { "type": "hex",      "bytes": 32, "apps": ["golinks-api"] }
    },
    "connections": {
      "DATABASE_URL": {
        "template": "postgres://golinks:${POSTGRES_PASSWORD}@db:5432/golinks",
        "service":  { "app": "golinks-api", "name": "db" },
        "apps":     ["golinks-api"],
        "sharedWith": ["golinks-worker"]
      }
    },
    "manual": []
  }
}
```

**Types** (`src/stack/types.ts`):

```ts
export interface StackManifest {
  name: string
  stackVersion: string
  apps: StackApp[]
  order: string[]                       // app names, dependency order for apply
  secrets: {
    generate: Record<string, GenerateSecret>
    connections: Record<string, ConnectionSecret>
    manual: string[]                    // names the tool won't invent; user sets them
  }
}
export interface StackApp { name: string; manifest: string; role: AppRole }
export type AppRole = "api" | "web" | "worker" | "resource" | "app"
export interface GenerateSecret { type: "password" | "hex"; bytes: number; apps: string[] }
export interface ConnectionSecret {
  template: string                      // ${GEN} refs resolved from generate[]
  service: { app: string; name: string } // the backing service this reaches
  apps: string[]                        // consumers KNOWN to reach it (validated)
  sharedWith?: string[]                 // requested cross-app consumers (validated → may flag)
}
```

Semantics:
- **generate** — the tool creates random values and sets them on `apps`.
- **connections** — *derived* secrets: `template` is a shell-free string with
  `${NAME}` references to `generate` keys; resolved to a concrete value and set
  on `apps`. `service` records which backing service (and its owning app) the
  connection reaches, so reachability can be validated.
- **manual** — secrets the tool could not classify. It never invents these; it
  reminds the operator to `lwd secret set` them (and `deploy` fails closed if a
  `manual` secret is still unset at apply — surfacing lwd's own fail-closed).

Manifest read/write mirrors `project/manifest.ts` (`readJson`/`writeJson`,
`paths.stackManifest = "deploy/stack.json"`). Validation: unique app names;
every `order` entry and every `apps`/`sharedWith` reference resolves to a
declared app; every connection `${NAME}` resolves to a `generate` key;
`service.app` is a declared app; secret names match `^[A-Z][A-Z0-9_]*$`.

## `stack init` — inference (proposal)

Parses each `deploy/*.lwd.toml` (a new TOML *reader* — forge only writes toml
today) plus `forge.json` if present, then proposes the manifest via a small
classification catalog (`src/stack/infer.ts`):

- **Group & order.** Each `*.lwd.toml` (its `name`) is an app. Role inferred
  from `forge.json.apps[*].role` when present, else heuristics (has `[[services]]`
  or `image=postgres|redis|...` and no `[git]` → `resource`; `worker` in name →
  `worker`; `port==80` + web framework → `web`; else `api`). Order = resources →
  apis → workers → web.
- **Backing-service secrets.** A `[[services]]` postgres image → `generate`
  `POSTGRES_PASSWORD` (type password, 24 bytes) scoped to the owning app; and if
  an app declares a `DATABASE_URL` secret, propose a `connections.DATABASE_URL`
  with `template = postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${svc}:5432/${POSTGRES_DB}`
  built from the service's `env` (`POSTGRES_USER`/`POSTGRES_DB`) and `name`.
  Same shape for `redis`→`REDIS_URL`, `minio`→`S3_ENDPOINT`/`S3_ACCESS_KEY_ID`/
  `S3_SECRET_ACCESS_KEY`. Catalog is a data table, easily extended.
- **Random secrets.** App `secrets` matching `JWT_SECRET`, `*_SECRET`, `*_PEPPER`,
  `*_KEY`, `*_TOKEN` (and not already a connection/service secret) → `generate`
  hex 32 bytes.
- **Manual.** Any remaining declared secret the catalog can't classify → `manual`.
- **Cross-app propagation guess.** If the same secret name (e.g. `DATABASE_URL`)
  is declared by multiple apps but the service is co-located in one, the extra
  apps go into that connection's `sharedWith` (so `init` records intent; `deploy`
  validates and may flag — see below).

The proposal is **written for review** via the `Plan` (create/append/overwrite
classified; refuses to clobber a differing hand-edited `deploy/stack.json`
without `--force`). No hidden magic — the emitted JSON is the contract.

## `stack deploy` — wiring + connectivity flag

`src/stack/wire.ts` resolves the manifest into a concrete set of
`{ app, key, value }` operations, then applies:

1. **Per app, read existing names:** `lwd secret ls <app>` (names only — lwd
   never returns values).
2. **Resolve generate secrets:** for each `generate` entry × its `apps`, if the
   name is absent for that app, create a random value (`crypto.randomBytes` →
   `hex` or a URL-safe `password`) and record it for this run. Present → skip.
3. **Resolve connections:** for each connection absent on a consumer, substitute
   `${NAME}` from this run's freshly generated component values and set it.
   **Edge — component present, connection missing:** if a referenced component
   (e.g. `POSTGRES_PASSWORD`) already exists in lwd it was not regenerated, so the
   tool does **not** hold its value (lwd never returns values) and cannot derive
   the connection. It does not guess or blank it — it flags:
   *"cannot derive DATABASE_URL for golinks-worker: POSTGRES_PASSWORD is already
   set and its value is not retrievable. Re-run with `--rotate POSTGRES_PASSWORD`
   to re-establish it and all derived connections, or set DATABASE_URL manually."*
   In the common path (fresh deploy, or a re-deploy where both component and
   connection are already present and skipped) this edge never triggers.
4. **Connectivity validation (the honest part).** For every connection, each
   consumer must be able to reach `service`:
   - the **owning app** (`service.app`) reaches its co-located backing service by
     the service `name` on its per-app network → **valid**;
   - any consumer in `apps`/`sharedWith` that is **not** the owner, when the
     service is co-located (a `[[services]]` block, not a standalone reachable
     resource app) → **cannot reach it** under lwd's per-app network isolation.
     `deploy` **refuses to set a broken value** and prints remediation:
     *"golinks-worker can't reach `db` co-located in golinks-api. Move Postgres
     to a dedicated app (split topology) so it's reachable across apps."*
     `--force` is NOT an override here — a broken connection string is never
     written; the operator fixes topology or removes the consumer.
5. **Set secrets, then apply:** for each app in `order`, `lwd secret set <app>
   <KEY>` (value piped via stdin — never in argv) for its missing secrets, then
   `lwd apply <manifest>`. Unless `--no-wait`, gate on `lwd status <app>` healthy
   before the next app. A still-unset `manual` secret for an app aborts that
   app's apply with a clear message (mirrors lwd's fail-closed).

`--dry-run` prints the full plan — group, order, and per app: secrets
already-set (skip) / to-generate / to-derive / manual-missing, plus any
connectivity flags — with **all values masked**. Nothing is executed.

## Idempotency — no local secret store

lwd is the **sole** value store. Both the component secret (`POSTGRES_PASSWORD`)
**and** the derived connection secret (`DATABASE_URL`) are stored independently in
lwd. So on re-deploy, `lwd secret ls` shows both present and the tool skips them —
**no recompute, no silent rotation, no value ever written to disk**. The only
recompute path is explicit: `--rotate <KEY>` regenerates that generated secret and
re-derives every connection whose template references it (dependency known from
the manifest), re-setting all affected apps. This deliberately avoids a
`.forge/secrets.json`-style on-disk cache (a gitignore footgun and a secret at
rest outside lwd's encrypted store).

## lwd CLI adapter — `src/stack/lwd.ts`

Thin wrapper over the `lwd` binary (found on `PATH`), inheriting ambient
`LWD_DAEMON`/`LWD_API_TOKEN` so it targets local or remote daemons unchanged:

- `secretLs(app): Promise<string[]>` — parse `lwd secret ls <app>` (names only).
- `secretSet(app, key, value)` — `lwd secret set <app> <key>` with `value` on
  **stdin** (never argv/history).
- `apply(manifestPath)` — `lwd apply <path>`.
- `status(app): Promise<AppStatus>` — parse `lwd status <app>` (health/state).
- `rm(app)` / volume handling for `--destroy-data`.

Requires a **capturing** shell helper. `utils/shell.ts` currently only has
`run()` (stdio inherited, returns exit code); add `capture(cmd, args, cwd, {
stdin? }): Promise<{ code, stdout, stderr }>` (piped stdio) without changing
`run()`. The adapter surfaces a clear error if `lwd` is not on `PATH` or the
daemon is unreachable (reusing lwd's own error text).

`stack rm` data safety: default `lwd rm <app>` leaves named volumes; with
`--destroy-data`, additionally remove the app's named data volumes (via the lwd
CLI's data-removal path). Never removes a volume without the explicit flag.

## Code structure (forge, TypeScript, CommonJS)

- `src/commands/stack.ts` — `stackCommand(action, opts)` dispatch (`init` /
  `deploy` / `status` / `rm`); `forge deploy` alias → `stackCommand("deploy", …)`.
- `src/stack/types.ts` — the manifest + secret types above.
- `src/stack/manifest.ts` — load/save/validate `deploy/stack.json`.
- `src/stack/infer.ts` — repo inspection + proposal (the classification catalog).
- `src/stack/lwdtoml.ts` — minimal lwd.toml **reader** (name/domain/port/env/
  secrets/`[[services]]`/`[git]`/`[build]`/`[health]`) via a TOML parse dep.
- `src/stack/wire.ts` — resolve secrets, connectivity validation, ordering.
- `src/stack/lwd.ts` — the lwd CLI adapter.
- `src/cli.ts` — register the `stack` group + `deploy` alias.
- `src/project/paths.ts` — add `stackManifest: "deploy/stack.json"`.
- `src/utils/shell.ts` — add `capture()` (keep `run()` intact).

**New dependency:** a TOML parser. Use `@iarna/toml` (CommonJS-compatible, stable,
parses the needed subset incl. inline tables + arrays-of-tables). `smol-toml` is a
modern alternative but is ESM-only and would fight forge's `"type":"commonjs"`.

## Testing (vitest)

- `infer`: golinks fixture (the three real `deploy/*.lwd.toml` + `forge.json`) →
  proposes the expected manifest: `generate` = {POSTGRES_PASSWORD, JWT_SECRET,
  API_KEYS_PEPPER}, `connections.DATABASE_URL` with the postgres template and
  `service={app:golinks-api,name:db}`, worker in `sharedWith`, correct `order`.
- `lwdtoml`: parses the golinks manifests (secrets array, `[[services]]` env +
  secrets, `[git]`/`[build]`).
- `wire`: DATABASE_URL derives `postgres://golinks:<pw>@db:5432/golinks`;
  connectivity validation **flags** golinks-worker (co-located db in api) and
  **passes** the same in a split-topology fixture (dedicated `golinks-db` app).
- `wire` idempotency: given `secretLs` returning existing names, no set is issued
  for those; `--rotate POSTGRES_PASSWORD` re-issues POSTGRES_PASSWORD **and**
  DATABASE_URL.
- `deploy` ordering: apply calls happen in `order`; a `manual`-unset secret
  aborts that app.
- `dry-run`: no `secretSet`/`apply` calls; output masks values (assert no
  generated value string appears in output).
- lwd adapter tested against a **mock** `lwd` (a stub script on `PATH`, or the
  adapter parameterized with an injectable runner) — no real daemon in CI.

## Docs

- README: add a `forge stack` row to the command table and a short "Deploying a
  stack" section (init → review `deploy/stack.json` → deploy).
- `docs/stack-delivery.md`: the manifest schema, the inference catalog, the
  connectivity/isolation rule (why cross-app co-located DBs are flagged), and the
  idempotency/rotation model.
- Update golinks' README deploy section (separately, in the golinks repo) to the
  one-command flow once shipped — noted, not part of this repo's plan.

## Self-review notes

- Scope is one cohesive subsystem (a delivery command group) — single plan.
- Security: no secret values on disk; values piped via stdin; dry-run masks
  values; `manual` secrets never invented; connectivity never writes a broken
  value even with `--force`.
- Zero lwd changes; forge's existing commands untouched (`run()` preserved,
  new `capture()` added alongside).
- Honest boundary: cross-app connectivity is *detected and flagged*, not solved —
  solving it needs lwd-side shared networking, which is deferred.
