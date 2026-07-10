---
name: obh-retrofit-api-keys
description: Use to assess or replace hand-rolled machine-to-machine credentials with @obh/api-keys. Finds bespoke API-key auth (header checks against a keys table, randomBytes keygen, per-key permission checks, static service tokens) and maps each to scoped, peppered-hashed keys. Assessment-only by default; implements on request.
---

Purpose: consolidate non-human credentials behind the **api-keys** primitive. Instead of the product minting, storing, and comparing its own tokens, keys are peppered-hashed, issued with explicit **scopes**, and verified with one client call. `@obh/api-keys` owns the keys table; the product authenticates a bearer and checks a scope.

## Assessment (read-only)

1. **Find the current credential code.** Grep for: `x-api-key` / `apikey` / `Authorization` header parsing on machine routes; a keys/`tokens`/`api_keys` table and lookups against it; key generation (`crypto.randomBytes`, `nanoid`, `uuid` used as a secret); static service tokens compared from env (`Bearer ${process.env.SERVICE_TOKEN}`); and any per-key permission/role checks.

2. **Inventory each key surface.** For every machine-authenticated route or client, record: how the key is presented, how it's stored (plaintext? hashed? how?), what it authorizes, and who holds it. Flag plaintext-at-rest and shared/static tokens as the highest-risk items.

3. **Design the scope model.** Enumerate machine capabilities as `resource:action` scopes (`notes:write`, `reports:read`, `billing:admin`). Map each protected route to the single scope it should require. Keep scopes coarse enough to be memorable, fine enough to least-privilege.

4. **Map each site to the target grammar.** Verification becomes `ctx = await apiKeys.authenticate(bearer)` (throws `ApiKeyAuthError` → 401) then `apiKeys.hasScope(ctx, "resource:action")` (else 403). Issuance becomes `apiKeys.create({ workspaceId, name, scopes })`, which returns the plaintext key **once**. Note that old key plaintext cannot be recovered — cutover means re-issuing.

Produces the **api-keys retrofit plan**. Nothing above mutates the repo — a valid stopping point when you only need the survey.

## Implementation (only after the plan is agreed)

5. **Install.** `forge add api-keys` (`--dry-run` first). Adds the migration to `scripts/migrations.d/*`, the client at `apps/api/src/platform/api-keys.ts` (`createApiKeysClient({ db: pgAdapter(pool), pepper })`), and a scope-protected machine route. Run `pnpm migrate`. Record `API_KEYS_PEPPER` as a required secret NAME (set via `lwd secret set`, never committed; keys are useless if it changes).

6. **Swap verification behind the existing middleware.** Replace the body of the current auth middleware/guard with `authenticate` + `hasScope`, keeping its signature so routes don't change. Return 401 on `ApiKeyAuthError`, 403 on missing scope.

7. **Re-issue and cut over.** Issue new keys via `apiKeys.create(...)` for each holder, distribute out-of-band, and run a dual-accept window (old check ∥ new client) if callers can't rotate instantly. Then remove the old keygen/lookup/comparison code and drop the legacy keys table once nothing reads it.

8. **Validate.** `forge doctor`.

## Output

**Assessment →** the api-keys retrofit plan: a table of key surface → presentation → current storage (flag plaintext/static) → required `resource:action` scope → replacement (`authenticate`/`hasScope`/`create`), plus the scope catalogue and a re-issue/rotation note. **Implementation →** the installed client + protected routes, `API_KEYS_PEPPER` secret NAME, the middleware swap, and the retired legacy credential code.
