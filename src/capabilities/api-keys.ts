import type { Capability } from "./types"
import { addPlatformPackage, apiFramework, hasNotesExample, migrationModule } from "./helpers"

export const apiKeys: Capability = {
  name: "api-keys",
  describe: "Scoped machine API keys — hashed at rest, verified per request with required scopes",
  apply(ctx, plan) {
    addPlatformPackage(plan, ctx, "api-keys", { api: true })
    plan.create("scripts/migrations.d/api-keys.ts", migrationModule("api-keys"), "api-keys migrations wiring")

    if (ctx.hasApp("api")) {
      plan.create("apps/api/src/platform/api-keys.ts", CLIENT, "api-keys client")
      plan.create("apps/api/src/routes/machine.ts", apiFramework(ctx) === "hono" ? ROUTE_HONO(hasNotesExample(ctx)) : ROUTE_EXPRESS(hasNotesExample(ctx)), "scope-protected machine route")
    }

    plan.addEnvVar({ name: "API_KEYS_PEPPER", example: "change-me-32-bytes-min", comment: "required — API keys won't work without it", secret: true })

    plan.patchManifest({ platform: { "api-keys": true } })
    plan.nextStep("Run `pnpm migrate` and set API_KEYS_PEPPER (secret). Issue keys via apiKeys.issue({ scopes }).")
  },
}

const CLIENT = `// Adjust to the @obh/api-keys version you install.
import { createApiKeysClient, pgAdapter } from "@obh/api-keys"
import { pool } from "../db"

export const apiKeys = createApiKeysClient({
  db: pgAdapter(pool),
  pepper: process.env.API_KEYS_PEPPER!,
})
`

function ROUTE_HONO(notes: boolean): string {
  const body = notes
    ? `    // Protected: only machines whose key carries the "notes:write" scope get through.
    const key = c.req.header("authorization")?.replace(/^Bearer /, "")
    const result = await apiKeys.verify(key, { scope: "notes:write" })
    if (!result.ok) return c.json({ error: "forbidden" }, 403)
    const input = await c.req.json<{ title?: string; body?: string }>()
    if (!input.title) return c.json({ error: "title is required" }, 400)
    return c.json(await notes.createNote({ title: input.title, body: input.body }), 201)`
    : `    const key = c.req.header("authorization")?.replace(/^Bearer /, "")
    const result = await apiKeys.verify(key, { scope: "machine:write" })
    if (!result.ok) return c.json({ error: "forbidden" }, 403)
    return c.json({ ok: true, keyId: result.keyId })`
  const imports = notes
    ? `import { apiKeys } from "../platform/api-keys"
import * as notes from "../domain/notes"`
    : `import { apiKeys } from "../platform/api-keys"`
  return `import type { Hono } from "hono"
${imports}

export function register(app: Hono): void {
  app.post("/machine/notes", async (c) => {
${body}
  })
}
`
}

function ROUTE_EXPRESS(notes: boolean): string {
  const body = notes
    ? `    const key = (req.headers.authorization ?? "").replace(/^Bearer /, "")
    const result = await apiKeys.verify(key, { scope: "notes:write" })
    if (!result.ok) return res.status(403).json({ error: "forbidden" })
    if (!req.body.title) return res.status(400).json({ error: "title is required" })
    res.status(201).json(await notes.createNote({ title: req.body.title, body: req.body.body }))`
    : `    const key = (req.headers.authorization ?? "").replace(/^Bearer /, "")
    const result = await apiKeys.verify(key, { scope: "machine:write" })
    if (!result.ok) return res.status(403).json({ error: "forbidden" })
    res.json({ ok: true, keyId: result.keyId })`
  const imports = notes
    ? `import { apiKeys } from "../platform/api-keys"
import * as notes from "../domain/notes"`
    : `import { apiKeys } from "../platform/api-keys"`
  return `import type { Express, Request, Response } from "express"
${imports}

export function register(app: Express): void {
  app.post("/machine/notes", async (req: Request, res: Response) => {
${body}
  })
}
`
}
