---
name: obh-lwd-manifest
description: Use when generating or updating lwd deploy manifests for a Forge project. Encodes real lwd constraints — worker as a separate surface, no co-located Postgres on a replicated API, per-app network isolation, secret NAMES only — and prefers `forge generate lwd` over hand-editing.
---

Purpose: produce correct `deploy/*.lwd.toml` manifests that match the app topology. Prefer generating them with Forge; hand-edit only for constraints the generator can't infer. lwd manifests reference secret **NAMES** only — values are set out-of-band with `lwd secret set`.

## Workflow

1. **Read the topology.** From `forge.json` and `apps/*`, list the deployable surfaces: api, admin/web, worker. Note replica intent (is the API meant to scale, `replicas > 1`?) and whether a database is expected to be managed by lwd or external.

2. **One surface per manifest, correctly typed.** Each app gets its own `deploy/<app>.lwd.toml`. A **worker is a separate surface** from the API — it needs its own domain/entrypoint and its **own health check** (a liveness signal from the tick loop, not the API's HTTP `/health`). Don't fold the worker into the API manifest.

3. **Apply the Postgres co-location rule.** A `[[services]]` Postgres may be co-located only with a single-instance surface. If the API is scalable (`replicas > 1`), it **cannot** co-locate a `[[services]]` Postgres — point it at an external/managed database instead. A small dev/single-replica API may co-locate Postgres.

4. **Isolate networks per app.** Give each app its own network scope; don't share a network across surfaces beyond what they must reach. The worker and API connect to the same database but are otherwise isolated.

5. **Reference secret NAMES only.** List required secrets by NAME (DB URL, S3/files keys, API-key signing secret, webhook signing secret, SMTP for notifications). Never put values in the toml. Add a note that each is provisioned with `lwd secret set <NAME>` per environment.

6. **Choose small vs. split topology.** **Small**: api + worker + co-located Postgres, single replicas — fine for dev/low volume. **Split**: replicated API (external DB) + independent worker + managed Postgres — for production scale. Pick based on the replica intent from step 1.

7. **Generate, then review.** Run `forge generate lwd` (`--dry-run` first) to emit/update the manifests from `forge.json`. Hand-edit only for things the generator can't know: replica counts, external-DB endpoints, worker health specifics, network scoping. Re-run `forge doctor` to validate.

## Output

The `deploy/*.lwd.toml` manifests (one per surface) with correct types, health checks, network isolation, and secret NAMES; the `forge generate lwd` command used (with `--dry-run`); a short topology recommendation (small vs. split) tied to replica intent; a list of secrets to `lwd secret set`; and an explicit note of any hand-edits made and why the generator couldn't produce them.
