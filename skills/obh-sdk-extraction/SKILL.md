---
name: obh-sdk-extraction
description: Use when types and API-client code are duplicated between the backend and one or more frontends. Proposes extracting a single packages/sdk (shared types + one typed client), then migrating callers one resource at a time behind a compatibility re-export.
---

Purpose: eliminate drift between backend and frontend(s) by making `packages/sdk` the single source of shared types and the one typed API client. The migration is incremental and non-breaking: callers move one resource at a time behind a compatibility re-export so nothing breaks mid-flight.

## Workflow

1. **Find the duplication.** Grep across `apps/api`, `apps/admin`, `apps/mobile`, and any frontend for: parallel type declarations (a `User`/`Invoice` interface defined in both backend and frontend), and hand-rolled/defensive fetch clients (bespoke `fetch` wrappers, per-call `try/catch` + manual JSON casting, ad-hoc base-URL handling). List each duplicated type and each client function, and which surfaces define/consume it.

2. **Pick the source of truth.** For shared types, the backend's domain types are usually canonical. For the client, design one typed client whose methods mirror the API routes (`apps/api/src/routes/*`). Note where request/response shapes disagree between front and back — those mismatches are latent bugs to resolve during extraction.

3. **Scaffold the package.** Run `forge add sdk` (`--dry-run` first) to create `packages/sdk` in the workspace and register it in `forge.json`. It holds shared types and a single `createClient`-style typed client — no framework-specific code, so every app (api, admin, mobile) can depend on it.

4. **Move types first.** Relocate the canonical types into `packages/sdk`. In each place that previously declared them, replace the declaration with a **compatibility re-export** from the sdk (`export type { User } from '@obh/sdk'`) so existing imports keep resolving unchanged.

5. **Migrate callers one resource at a time.** For each resource (users, invoices, …): point the frontend at the sdk client method, delete the hand-rolled client code for that resource, and remove its local types (now re-exported). Ship per-resource — the compatibility re-exports mean unmigrated resources keep working alongside migrated ones.

6. **Retire the shims.** Once every caller imports from `@obh/sdk` directly, remove the compatibility re-exports and the last defensive client wrappers. Verify each frontend still type-checks against the sdk.

## Output

An **sdk extraction plan**: a table of duplicated type / client-function → surfaces that define & consume it → canonical source → any front/back shape mismatch to fix; the `forge add sdk` step; a phased sequence (move types + re-export shims → migrate callers resource-by-resource → remove shims); and a per-resource checklist so the migration ships in safe, independent increments.
