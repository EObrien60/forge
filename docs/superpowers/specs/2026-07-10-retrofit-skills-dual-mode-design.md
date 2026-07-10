# Retrofit skills — full coverage + assessment/implementation split

**Status:** approved, in build
**Date:** 2026-07-10

## Goal

The primary use case for Forge starting out is **retrofitting old codebases** with
the `@obh/*` platform primitives. The bundled Claude skills do the interpretive
work (reading a repo, mapping legacy code onto a primitive). Two gaps:

1. **Coverage.** 7 of the 12 implemented primitives have a generator but no
   retrofit skill: `api-keys`, `webhooks`, `import-export`, `entitlements`,
   `search`, `analytics`, `notifications`.
2. **Mode.** Every skill barrels from discovery straight into mutation. For a
   retrofit the first thing you want is an **assessment** — what tooling this repo
   needs, how much of the legacy pattern exists, what each move costs — read
   before committing to any change.

## Deliverable

- **7 new skills** `skills/obh-retrofit-<primitive>/SKILL.md` for the primitives above.
- **All 16 skills** (8 existing + 7 new + `obh-inspect-project`) restructured into a
  consistent **Assessment (read-only) → Implementation (gated)** shape.
- **README** "Claude skills" list names all skills.
- **Guard test** `src/skills.test.ts` asserts every implemented primitive has a
  mapped skill.

## Skill shape (applied to all)

```
---
name: obh-<...>
description: <triggers on BOTH "assess what moving X to @obh would take" AND "do it">
---

Purpose: <one paragraph — what this primitive is, what legacy it replaces>

## Assessment (read-only)
<numbered steps: find the pattern, size it, map each site to the target grammar,
 note prerequisites + risks>
Produces the <primitive> retrofit plan. Nothing here mutates the repo — a valid
stopping point when you only need the survey.

## Implementation (only after the plan is agreed)
<numbered steps: forge add <x> (--dry-run first) → pnpm migrate → wire → cut over
 behind stable signatures → retire old code → forge doctor>

## Output
Assessment → the plan (table). Implementation → what changed + how to verify.
```

`obh-inspect-project` stays the top-level **read-only census** (it is assessment-only
by nature); its restructure just labels it as the Assessment entry point that points
at which per-primitive retrofit skill to run next. `obh-lwd-manifest` and
`obh-sdk-extraction` get the same split (assess the topology / duplication first,
generate/migrate second).

## Per-primitive mapping (grammar from `src/capabilities/*` — the source of truth)

| Skill | Legacy signals | Target grammar | Prereq |
|---|---|---|---|
| obh-retrofit-api-keys | `x-api-key`/Bearer vs keys table, `randomBytes` keygen, per-key scope checks, static service tokens | `apiKeys.authenticate(bearer)`→`ApiKeyAuthError`/`hasScope`; `create({workspaceId,name,scopes})`; peppered hash, plaintext once; `API_KEYS_PEPPER` | — |
| obh-retrofit-webhooks | outbound POSTs to customer URLs, `webhook_endpoints`/`subscriptions`, manual HMAC, retry/status columns | `webhooks.createEndpoint(db,{…,eventPatterns})` (secret once)/`listEndpoints`; worker fans events→signed/retried/dead-lettered deliveries; `WEBHOOK_SECRET_ENCRYPTION_KEY` | events |
| obh-retrofit-import-export | `csv-parse`/`papaparse`/`fast-csv`, multipart CSV upload-then-insert, sync CSV export routes | `defineImport`(idempotent `commitRow`)/`defineExport` registry over files-backed `FileStore`; API `imports.createBatch`/`exports.createExport` + enqueue `import_parse_csv`/`export_generate_csv`; worker drains | files, jobs |
| obh-retrofit-entitlements | `user.plan==='pro'`, hardcoded `MAX_*`, seat/quota checks, Stripe-plan→feature maps | before write: `entitlements.require(db,ws,key)` (boolean)/`limit(db,ws,key)` (number); code-default<plan<workspace grant; `listEffective`/`explain` | — |
| obh-retrofit-search | `LIKE '%…%'`/`ILIKE`, ad-hoc `to_tsvector`, Elastic/Algolia/Meili, row-scanning `/search` | `search.query({workspaceId,query})` (PG FTS+trigram); worker index via `defineSearchEntity` on create/update/delete events; backfill existing rows | events |
| obh-retrofit-analytics | `count(*)…group by date_trunc`, rollup cron/tables, live-aggregating KPI endpoints, Mixpanel/Amplitude | `defineMetric({key,events,aggregation})` (api+worker copies); `analytics.timeseries({…,bucket})`; worker rolls facts into buckets; forward-looking → event backfill note | events |
| obh-retrofit-notifications | `nodemailer`/`sendgrid`/`resend`/`ses` sends, inline `sendMail` in handlers, hardcoded templates | event path: `defineTemplate`+`defineNotificationRule(eventName→template,recipient,variableMapping)`, worker seeds+sends SMTP; `createNotificationClient` direct-send escape hatch; `SMTP_URL` | events |

## Guard test

`src/skills.test.ts` (must be under `src/` — vitest `include: ["src/**/*.test.ts"]`).
Holds an explicit `CapabilityName → skill dir` map for all 12 primitives; asserts
every `CAPABILITIES` key is mapped, each dir has a `SKILL.md`, frontmatter `name`
equals the dir, `description` is non-empty. Adding a primitive with no skill fails.

Mapping: events→obh-add-events, jobs→obh-retrofit-jobs, files→obh-retrofit-files,
audit→obh-generate-audit-rules, settings→obh-settings-migration,
api-keys→obh-retrofit-api-keys, webhooks→obh-retrofit-webhooks,
import-export→obh-retrofit-import-export, entitlements→obh-retrofit-entitlements,
search→obh-retrofit-search, analytics→obh-retrofit-analytics,
notifications→obh-retrofit-notifications.

## Out of scope
Cloning `@obh/*` internals (generators encode the grammar); AST patching; changing
any generator or command behaviour.
