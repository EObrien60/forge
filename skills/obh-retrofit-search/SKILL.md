---
name: obh-retrofit-search
description: Use to assess or replace ad-hoc search with @obh/search. Finds LIKE/ILIKE queries, hand-rolled to_tsvector FTS, and external Elastic/Algolia/Meilisearch clients, then maps each searchable entity to a Postgres full-text index kept fresh from events. Assessment-only by default; implements on request.
---

Purpose: consolidate search behind the **search** primitive — Postgres full-text + trigram, kept fresh from domain **events**. The query side is one client call; the index is maintained worker-side by mapping each entity's create/update/delete events to a search document. No external search service. Requires an event catalogue (see obh-add-events).

## Assessment (read-only)

1. **Find the search code.** Grep for: `LIKE '%…%'` / `ILIKE` search filters; hand-rolled FTS (`to_tsvector`, `plainto_tsquery`, `ts_rank`, `@@`); external clients (`@elastic/elasticsearch`, `algoliasearch`, `meilisearch`, `opensearch`); and `/search` endpoints that scan or in-memory-filter whole tables.

2. **Inventory searchable entities.** For each type users search: which fields are matched (title vs body/content), where the query endpoint lives, how results rank today, and (for external services) what the index sync looks like. Flag full-table scans and drift-prone manual indexes as the risks this move fixes.

3. **Map query to the target grammar.** The endpoint becomes `search.query({ workspaceId, query })` over `createSearchClient({ provider: createPostgresSearchProvider({ db }) })`. Note the route and response shape that change.

4. **Map each entity to a `defineSearchEntity`.** For each type: the `events` that (re)index it (`["note.created","note.updated"]`), the `deleteEvents` that unindex it (`["note.deleted"]`), and `buildDocument`/`buildDeleteRef` mapping the event payload to `{ workspaceId, entityType, entityId, title, content }`. If those events don't exist, record that obh-add-events must run first. Note that the index is populated **forward** from events, so existing rows need a **backfill**.

Produces the **search retrofit plan**. Nothing above mutates the repo — a valid stopping point when you only need the survey.

## Implementation (only after the plan is agreed)

5. **Install.** `forge add search` (`--dry-run` first; auto-adds `events`). Adds the migration (enables `pg_trgm`), the client + query route in `apps/api`, and the worker side (`search-entities.ts`, `dispatch.d/search.ts` with `events: ["*"]`, `consumers.d/search.ts` running the indexer each tick). Run `pnpm migrate`.

6. **Author the entities.** Replace the example `defineSearchEntity` with the types from the plan (real event names, `buildDocument`, `buildDeleteRef`) in `apps/worker/src/search-entities.ts`. Confirm the mapped events are emitted (obh-add-events).

7. **Backfill and cut over.** Populate the index for existing rows — replay each entity's create event, or run a one-off backfill through the client. Point the app/UI at `GET /api/search?q=`, then retire the old `LIKE`/`to_tsvector` queries and tear down any Elastic/Algolia/Meili infrastructure and its sync.

8. **Validate.** `forge doctor`.

## Output

**Assessment →** the search retrofit plan: per entity, the source `events`/`deleteEvents` and the document mapping (title/content fields), the query-endpoint swap, the events that must exist first, and a backfill note. **Implementation →** the installed client/route/worker with authored entities, the backfilled index, and the retired legacy search (queries + external service).
