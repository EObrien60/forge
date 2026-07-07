# forge stack — repo → lwd delivery

`forge stack` turns a scaffolded monorepo (`apps/*`, `deploy/*.lwd.toml`) into a
running lwd deployment. It is a **pure client of the `lwd` CLI** — lwd gets zero
changes — that does the wiring lwd deliberately leaves out: grouping the apps,
generating secret *values*, deriving connection strings, ordering the apply, and
flagging cross-app reachability gaps.

## Commands

| Command | What it does |
|---|---|
| `forge stack init` | Parse `deploy/*.lwd.toml` (+ `forge.json`) → propose and write `deploy/stack.json`. Re-runnable: non-destructively merges newly-found apps/secrets into an existing manifest (hand edits preserved); `--force` rewrites from scratch. `--dry-run` prints the proposal. |
| `forge stack deploy` (alias `forge deploy`) | Read `deploy/stack.json`, resolve + set missing secrets, `lwd apply` each app in `order`, gate on health. `--dry-run` prints the plan with values masked. `--rotate <KEY>` / `--app <name>` / `--no-wait`. |
| `forge stack status` | Rolled-up `lwd status` across the stack. |
| `forge stack rm` | Tear down in reverse order. Named data volumes are preserved (lwd's CLI exposes no volume removal). |

## The stack manifest — `deploy/stack.json`

The reviewable delivery contract (distinct from `forge.json`, which is a receipt).

```jsonc
{
  "name": "golinks",
  "stackVersion": "0.1.0",
  "apps": [ { "name": "golinks-api", "manifest": "deploy/api.lwd.toml", "role": "api" }, … ],
  "order": ["golinks-api", "golinks-worker", "golinks-admin"],
  "secrets": {
    "generate": {            // random values the tool creates and sets on `apps`
      "POSTGRES_PASSWORD": { "type": "password", "bytes": 24, "apps": ["golinks-api"] },
      "JWT_SECRET":        { "type": "hex",      "bytes": 32, "apps": ["golinks-api"] }
    },
    "connections": {         // secrets DERIVED from generated components via a template
      "DATABASE_URL": {
        "template":  "postgres://golinks:${POSTGRES_PASSWORD}@db:5432/golinks",
        "service":   { "app": "golinks-api", "name": "db" },
        "apps":      ["golinks-api"],        // consumers known to reach the service
        "sharedWith":["golinks-worker"]       // requested cross-app consumers (validated → may flag)
      }
    },
    "manual": []             // secrets the tool won't invent; you `lwd secret set` them
  }
}
```

## Inference catalog (`stack init`)

- **Group & order.** Each `*.lwd.toml` is an app. Role from `forge.json` when
  present, else heuristics (postgres/redis image + no `[git]` → `resource`;
  `worker` in name → `worker`; `port 80` → `web`; else `api`). Order =
  resources → apis → workers → web.
- **Backing services.** A `[[services]]` `postgres` → generate `POSTGRES_PASSWORD`
  (password, 24 bytes) on the owning app; if an app declares `DATABASE_URL`,
  derive `connections.DATABASE_URL` with
  `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@<service>:5432/${POSTGRES_DB}`
  (user/db read from the service `env`). The catalog extends to `redis`→`REDIS_URL`,
  `minio`→`S3_*`, etc.
- **Random secrets.** App secrets matching `JWT_SECRET`, `*_SECRET`, `*_PEPPER`,
  `*_KEY`, `*_TOKEN` → generate hex 32 bytes.
- **Manual.** Anything unclassified → `manual` (the tool never invents it).
- **Cross-app.** The same secret declared by multiple apps but owned by one goes
  into that connection's `sharedWith` — `init` records the intent; `deploy`
  validates it.

## Connectivity & lwd's network isolation (the honest part)

lwd isolates each app on its own per-app network, so a **co-located** `[[services]]`
Postgres is reachable **only by its owning app**. On `deploy`, every connection
consumer is checked:

- the owning app reaches its co-located service → **valid**;
- a **dedicated resource app** (e.g. split-topology `golinks-db`) is reachable by
  everyone → **valid**;
- any other consumer of a **co-located** service → **cannot reach it**. `deploy`
  **refuses to write a broken connection string** (even with `--force`) and prints:
  *"golinks-worker can't reach `db` co-located in golinks-api: move it to a
  dedicated app (split topology)…"*.

This is detected and flagged, **not solved** — solving it needs lwd-side shared
networking, which is out of scope.

## Idempotency & rotation

lwd is the **sole** value store; no secret value is ever written to disk. Both the
component (`POSTGRES_PASSWORD`) and the derived connection (`DATABASE_URL`) are
stored independently in lwd, so a re-deploy sees both present (`lwd secret ls`) and
**skips** them — no recompute, no silent rotation.

The only recompute path is explicit: `--rotate <KEY>` regenerates that secret and
re-derives every connection whose template references it. Edge: if a component is
already set (value not retrievable) but its derived connection is missing, `deploy`
does not guess — it tells you to `--rotate` the component or set the connection
manually.

## Implementation

- `src/stack/types.ts` — the manifest + secret types.
- `src/stack/lwdtoml.ts` — an lwd.toml reader (`@iarna/toml`).
- `src/stack/manifest.ts` — load/save/validate `deploy/stack.json`.
- `src/stack/infer.ts` — the classification catalog / proposal.
- `src/stack/wire.ts` — pure `planSecrets` (skip/generate/derive/block) + deploy.
- `src/stack/lwd.ts` — the `lwd` CLI adapter (secret values on stdin, never argv).
- `src/commands/stack.ts` + `src/cli.ts` — the command group + `forge deploy` alias.
