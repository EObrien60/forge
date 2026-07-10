---
name: obh-settings-migration
description: Use to assess or consolidate scattered configuration — hardcoded constants, .env sprawl, or an untyped options/settings table — into typed @obh/settings definitions. Proposes scope/schema/default/sensitivity per key (assessment); then installs settings and runs a read-through-write-both cutover (implementation). Assessment-only by default; implements on request.
---

Purpose: replace ad-hoc config with the typed, scoped **settings** primitive. Each setting has a scope (global / workspace / user), a typed schema, a default, and a sensitivity flag. The migration is gradual: read through settings while writing both old and new stores until the old source is retired.

## Assessment (read-only)

1. **Inventory current config.** Grep for three patterns: hardcoded constants in source (magic numbers, feature flags, limits, URLs); `.env` / `process.env.*` usage (env sprawl, especially non-secret tuning values); and untyped key/value config tables (`settings`, `options`, `preferences`, `config` with a `value text` column). Record each key, its current type, where it's read, and who it varies by.

2. **Assign a scope.** Decide the narrowest scope that fits: **global** (one value for the whole deployment), **workspace/tenant** (per-organisation), or **user** (per-account). A single hardcoded constant that never varies is global; anything read per-request off the tenant/user is scoped.

3. **Define a typed schema + default.** For each key give a concrete type (boolean, number with range, enum, string, structured object) and a sensible default so a missing value never breaks. Group related keys under one definition where they move together.

4. **Mark sensitivity.** Flag secrets/credentials as sensitive — those stay out of logs and audit payloads and are supplied via deploy secret NAMES, not stored as plain settings values. Non-secret tuning values are normal settings and can move out of `.env` entirely.

Produces the **settings migration plan**. Nothing above mutates the repo — a valid stopping point when you only need the survey.

## Implementation (only after the plan is agreed)

5. **Install the primitive.** Run `forge add settings` (`--dry-run` first). This adds the settings migration to `scripts/migrations.d/*` and the `@obh/settings` client (`defineX`/`createSettingsClient`/`pgAdapter`). Run `pnpm migrate`. Write the `defineSettings` schemas from the plan.

6. **Migrate read-through, write-both.** Introduce a resolver that reads from `@obh/settings` and falls back to the old source (constant/env/options table) when unset — this is safe to ship immediately. For writable config, write to both stores during transition. Backfill existing option-table rows into settings. Once reads are served entirely from settings and backfill is verified, remove the fallback and the old constants/env keys/table. Then `forge doctor`.

## Output

**Assessment →** the settings migration plan: a table of key → scope → typed schema → default → sensitivity → current source (constant/env/table) and read sites, calling out which keys are sensitive and stay as deploy secrets. **Implementation →** the `forge add settings` + `pnpm migrate` steps with the `defineSettings` definitions written, and a phased cutover (read-through-with-fallback → write-both + backfill → remove old source).
