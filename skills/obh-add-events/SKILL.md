---
name: obh-add-events
description: Use when adding an event catalogue to a project's domain — turning writes into emitted facts. Inspects routes/services, proposes dot.notation event names with payloads and exact in-transaction emit sites, then guides `forge add events` and wiring emits into the app event bus.
---

Purpose: give a project a coherent set of domain **events** (facts) so other primitives can react, without inventing events that don't map to real state changes. Events are facts in `dot.notation` (e.g. `note.created`); they are emitted inside the write transaction that produced them.

## Workflow

1. **Find the writes.** Inspect `apps/api/src/routes/*.ts` and `apps/api/src/domain/*` for handlers that INSERT/UPDATE/DELETE or change state. Every meaningful state transition is a candidate fact. Ignore pure reads.

2. **Name events as facts.** Use `resource.pastTenseVerb` in dot.notation: `note.created`, `note.updated`, `note.deleted`, `invoice.paid`, `user.invited`. State changes get their own event (`order.shipped`), not a generic `order.updated`, when a consumer would care about the specific transition.

3. **Design payloads.** Each payload carries the IDs and the minimal facts a consumer needs — resource id, actor id, workspace/tenant id, and the fields that changed (or before/after for updates). Keep payloads flat and serialisable; reference large blobs by id, don't inline them. Avoid leaking secrets or full PII into payloads that audit/analytics will persist.

4. **Pin the transaction boundary.** For each event, identify the exact write transaction and place the emit **inside** it (same tx/connection as the DB write) so the fact and the state commit atomically via the outbox. Note the precise call-site (file + function + line region). If a handler does multiple writes, decide whether it emits one event or several.

5. **Map future consumers.** For each event, list which primitives should react: **notifications** (user-facing email/rules), **audit** (immutable trail), **analytics** (KPIs), **search** (index updates), **webhooks** (outbound), **jobs** (follow-up commands). This drives later `forge add` choices — don't wire them yet, just record intent.

6. **Install the primitive.** Run `forge add events` (use `--dry-run` first). This scaffolds the outbox/dispatcher migration in `scripts/migrations.d/*`, the `@obh/events` client, and the in-app bus at `apps/api/src/bus.ts`. Run `pnpm migrate` to apply the platform schema.

7. **Wire the emits.** In each write handler, call `bus.emit('note.created', payload)` inside the tx. Auto-loaded subscribers live in `apps/api/src/bus.d/*` — add a subscriber file per reacting concern (they run in-process; heavy work should enqueue a job rather than block the request). Use `defineX`/`createXClient` grammar from `@obh/events` for the typed event definitions.

## Output

An **event catalogue**: a table of `event.name` → payload shape → emitting file/tx site → intended consumers; the `forge add events` command (with `--dry-run` note) and `pnpm migrate` step; and a per-handler wiring plan showing where `bus.emit(...)` goes inside each transaction and which `bus.d/*` subscribers to create. Flag any write that currently emits nothing but should.
