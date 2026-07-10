---
name: obh-retrofit-webhooks
description: Use to assess or replace hand-rolled outbound webhook delivery with @obh/webhooks. Finds in-request POSTs to customer URLs, subscription/endpoint tables, manual HMAC signing, and retry/delivery-status columns, then maps event fan-out to signed, retried, dead-lettered deliveries run by the worker. Assessment-only by default; implements on request.
---

Purpose: move outbound webhooks behind the **webhooks** primitive so the product stops POSTing to customer URLs on the request path and hand-rolling signing/retry. Endpoints are managed per workspace; domain **events** fan out to per-endpoint deliveries that the worker signs, sends, retries with backoff, and dead-letters. Requires an event catalogue (see obh-add-events) — fan-out is event-driven.

## Assessment (read-only)

1. **Find the delivery code.** Grep for: `fetch`/`axios`/`got` POSTing to a stored/customer URL; `webhook_endpoints` / `subscriptions` / `hooks` tables; manual signing (`crypto.createHmac`, `X-Signature`, `X-Webhook-Signature`); retry loops, `attempts`/`delivery_status`/`last_error` columns; and any place a state change triggers an outbound call inline.

2. **Inventory endpoints and triggers.** Record each existing subscription (workspace, URL, which internal changes it fires on, how it's signed) and every in-request send site. Flag synchronous sends on the request path and any un-retried / silently-failing deliveries as the risks this move fixes.

3. **Map triggers to event patterns.** Each outbound trigger corresponds to a domain event. List the internal change → the `dot.notation` event → the `eventPatterns` an endpoint subscribes to (`note.*`, `invoice.paid`). If the triggering events don't exist yet, note that obh-add-events must run first.

4. **Map each site to the target grammar.** Endpoint management becomes `webhooks.createEndpoint(webhooksDb, { workspaceId, name, url, eventPatterns })` — the plaintext signing secret is returned **once** here — and `webhooks.listEndpoints(...)`. Delivery moves entirely to the worker: emitting the event is all the request handler does; the worker ingests events into per-endpoint deliveries and sends them (signed, retried, auto-disabling dead endpoints).

Produces the **webhooks retrofit plan**. Nothing above mutates the repo — a valid stopping point when you only need the survey.

## Implementation (only after the plan is agreed)

5. **Install.** `forge add webhooks` (`--dry-run` first; auto-adds `events`). Adds the migration, the client at `apps/api/src/platform/webhooks.ts` (`createWebhooksClient` + `webhooksDb = pgAdapter(pool)`), a manage-endpoints route, and the worker consumer (`apps/worker/src/dispatch.d/webhooks.ts` registering `events: ["*"]` + `consumers.d/webhooks.ts` running ingest + delivery each tick). Run `pnpm migrate`. Record `WEBHOOK_SECRET_ENCRYPTION_KEY` as a required secret NAME (encrypts per-endpoint secrets at rest).

6. **Ensure the events fire.** Confirm every mapped event is emitted inside its write transaction (obh-add-events). The worker's `["*"]` consumer picks them up — no per-event wiring needed.

7. **Migrate endpoints and retire old code.** Backfill existing subscriptions as endpoints (re-issuing signing secrets — old plaintext isn't recoverable), point customers at the new signature scheme, then delete the in-request POSTs, hand-rolled signing/retry, and legacy subscription table once deliveries flow through the worker.

8. **Validate.** `forge doctor`.

## Output

**Assessment →** the webhooks retrofit plan: a table of trigger site → event (+`eventPatterns`) → existing endpoint → replacement (`createEndpoint`/worker delivery), a list of events that must exist first, and the risks (sync sends, unretried failures) resolved. **Implementation →** the installed client/route/worker, `WEBHOOK_SECRET_ENCRYPTION_KEY` secret NAME, the migrated endpoints (with re-issued secrets), and the retired inline-delivery code.
