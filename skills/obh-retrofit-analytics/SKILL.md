---
name: obh-retrofit-analytics
description: Use to assess or replace hand-rolled KPI/metric code with @obh/analytics. Finds live count(*)/group-by aggregation endpoints, rollup cron and tables, and third-party tracking (Mixpanel/Amplitude/GA) calls, then maps each KPI to an event-derived metric timeseries. Assessment-only by default; implements on request.
---

Purpose: derive KPIs from domain **events** instead of aggregating product tables on the fly. Each metric is defined once (event + aggregation); the worker rolls facts into time buckets; the API serves a queryable timeseries. Requires an event catalogue (see obh-add-events) — metrics are computed from event facts, not the product tables.

## Assessment (read-only)

1. **Find the metric code.** Grep for: live aggregation in request handlers (`count(*)`, `sum(...)`, `group by date_trunc(...)`); rollup/summary tables and the cron that fills them; dashboard/KPI endpoints; and third-party tracking (`mixpanel`, `amplitude`, `analytics.track`, `gtag`).

2. **Inventory each KPI.** For each: what it measures, the aggregation (count / sum-of-a-field / …), the bucket granularity (day/week/…), and which state change it counts. Flag expensive live aggregations and drift-prone rollup tables as the risks this move fixes.

3. **Map each KPI to a `defineMetric`.** Give each a key and bind it to the event(s) it derives from: `defineMetric({ key: "notes_created", events: "note.created", aggregation: "count" })` (or a sum over a payload field). If the counted state change has no event, record that obh-add-events must run first.

4. **Map query to the target grammar.** The KPI endpoint becomes `analytics.timeseries({ workspaceId, metric, bucket })` over `createAnalyticsClient({ db, metrics })`. Note that analytics rolls up events **from now on**, so historical KPIs need an event **backfill**/replay.

Produces the **analytics retrofit plan**. Nothing above mutates the repo — a valid stopping point when you only need the survey.

## Implementation (only after the plan is agreed)

5. **Install.** `forge add analytics` (`--dry-run` first; auto-adds `events`). Adds the migration, the client + `GET /api/analytics/:metric` route in `apps/api`, and the worker side (`analytics-metrics.ts`, `dispatch.d/analytics.ts` with `events: ["*"]`, `consumers.d/analytics.ts` rolling facts into buckets each tick). Run `pnpm migrate`.

6. **Author the metrics.** Replace the example `defineMetric` with the KPIs from the plan, keeping the api and worker copies in sync (the worker never imports from `apps/api`). Confirm the source events are emitted (obh-add-events).

7. **Backfill and cut over.** For KPIs that need history, replay the source events so past buckets fill. Point dashboards at the timeseries endpoint, then retire the live-aggregation queries and rollup cron/tables once the timeseries covers them.

8. **Validate.** `forge doctor`.

## Output

**Assessment →** the analytics retrofit plan: a table of KPI → metric key → source event(s) → aggregation → bucket → replacement (`timeseries`), the events that must exist first, and a historical-backfill note. **Implementation →** the installed client/route/worker with authored metrics, the backfilled buckets, and the retired live-aggregation/rollup code.
