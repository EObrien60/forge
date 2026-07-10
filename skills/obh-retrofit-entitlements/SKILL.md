---
name: obh-retrofit-entitlements
description: Use to assess or replace hand-rolled plan gating, feature flags, and hardcoded limits with @obh/entitlements. Finds plan/tier checks, MAX_* constants, seat/quota guards, and Stripe-plan→feature maps, then maps each to a typed entitlement enforced before the write. Assessment-only by default; implements on request.
---

Purpose: replace scattered access/limit logic with the **entitlements** primitive. Each gated feature or numeric limit becomes a typed entitlement with a code default; grants layer on top (code default < plan < workspace override). Enforcement is one call **before the write** — a boolean `require` or a numeric `limit` compared against current usage.

## Assessment (read-only)

1. **Find the gating code.** Grep for: plan/tier checks (`user.plan === 'pro'`, `tier`, `isPremium`, `plan.features.includes`); hardcoded limits (`MAX_NOTES`, `LIMIT`, `if (count >= 100)`, seat/quota checks); feature flags tied to billing; and Stripe/billing → feature maps.

2. **Inventory each gate.** For each: what it protects, whether it's a **boolean** capability or a **numeric** limit, the current default, how it varies (by plan? by workspace?), and every call-site that checks it. Flag limits duplicated across call-sites and checks that happen *after* the write as the risks this move fixes.

3. **Design the entitlement keys.** Give each gate a stable key and type: `defineEntitlement({ key: "notes.max", type: "number", defaultValue: 100 })` or `{ key: "app.export", type: "boolean", defaultValue: false }`. Choose the narrowest scope (usually workspace). Map existing plan tiers to the grants that raise each default.

4. **Map each call-site to the target grammar.** Boolean gates become `await entitlements.require(entitlementsDb, WORKSPACE, key)` (throws `EntitlementRequiredError`) before the action. Numeric limits become `const max = await entitlements.limit(entitlementsDb, WORKSPACE, key)` then a count check against current usage. Reads/UX use `entitlements.listEffective(...)` / `explain(...)`.

Produces the **entitlements retrofit plan**. Nothing above mutates the repo — a valid stopping point when you only need the survey.

## Implementation (only after the plan is agreed)

5. **Install.** `forge add entitlements` (`--dry-run` first). Adds the migration and `apps/api/src/platform/entitlements.ts` (registry + `createEntitlementsClient({ registry })` + `entitlementsDb = pgAdapter(pool)` + a guard helper) and a read route. Run `pnpm migrate`.

6. **Author the registry and grants.** Replace the example `defineEntitlement` with the keys from the plan, register them in `createEntitlementRegistry([...])`, and grant the per-plan / per-workspace overrides that reproduce today's tiers. Backfill grants from existing plan data so no workspace loses access at cutover.

7. **Enforce before the write, then retire.** Insert `require`/`limit` guards at each write site (before the state change). Keep the old inline check in parallel during transition if you want a safety net, then delete the plan/tier constants and duplicated limit checks once entitlements own the decision.

8. **Validate.** `forge doctor`.

## Output

**Assessment →** the entitlements retrofit plan: a table of gate → key → type (boolean/number) → default → varies-by (plan/workspace) → call-sites → replacement (`require`/`limit`), plus the plan→grant mapping and a backfill note. **Implementation →** the installed registry/client/guard + read route, the authored keys and grants, the enforced write sites, and the retired inline gating.
