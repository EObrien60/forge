---
name: obh-retrofit-jobs
description: Use when moving slow, scheduled, or background work off the request path onto the OBH jobs queue. Finds cron routes, slow synchronous handlers, report/import/cleanup tasks and proposes converting each to an idempotent OBH Job enqueued inside a transaction, with a worker handler.
---

Purpose: get long-running or deferred work out of API request handlers and into durable, retryable **jobs** (commands). Jobs are commands in `snake_case` (e.g. `send_invoice_email`, `rebuild_search_index`); they are enqueued transactionally and run in the worker.

## Workflow

1. **Find candidates.** Grep the API for: cron/scheduled routes (`/cron/*`, `node-cron`, `setInterval`, Vercel cron); handlers doing heavy synchronous work (loops over rows, external HTTP calls, PDF/report generation, bulk email); import/export processing; cleanup/retention tasks; anything that makes the request slow or can fail partway.

2. **Name each as a command.** `snake_case` imperative: `generate_monthly_report`, `import_contacts_csv`, `purge_expired_sessions`, `send_welcome_email`. One job = one unit of retryable work.

3. **Design an idempotent handler.** Each job must be safe to run more than once (at-least-once delivery). Use a natural idempotency key (resource id + operation, or a dedup column), upserts instead of blind inserts, and guard against double side-effects (e.g. mark-then-send). Define the payload as the minimal input the handler needs — pass ids, re-fetch current state inside the handler.

4. **Place the enqueue inside a tx.** Enqueue the job in the **same transaction** as the state change that should trigger it, so a committed write always has its follow-up queued and a rolled-back write never leaks a job. Where a job should follow a fact, prefer emitting an event (see obh-add-events) and enqueueing the job from a subscriber — events are facts, jobs are the commands they trigger.

5. **Install and scaffold.** Run `forge add jobs` (`--dry-run` first). This adds the queue migration in `scripts/migrations.d/*`, the `@obh/jobs` client (`createJobsClient`/`pgAdapter`/`runMigrations`), and a worker surface. Run `pnpm migrate`.

6. **Write the worker handler.** Add a consumer under `apps/worker/src/consumers.d/*.ts` exporting `init(ctx)` / `tick(ctx)` (auto-loaded). Bind each `snake_case` job to its handler; keep handlers small, log start/finish, and let the queue handle retry/backoff rather than catching-and-swallowing.

7. **Retire the old path.** Replace the synchronous body of the original route with an enqueue that returns quickly (202/accepted). Remove cron routes once the worker owns the schedule. Keep the old code behind the same function signature during transition if callers depend on it.

## Output

A **jobs retrofit plan**: a table of source (route/task) → `job_name` (snake_case) → payload → idempotency key → enqueue tx site → worker consumer file; the `forge add jobs` + `pnpm migrate` steps; and per-route notes on what the handler returns after enqueue and which cron/synchronous code is removed.
