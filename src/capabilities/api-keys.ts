import type { Capability } from "./types"
import { addPlatformPackage, apiFramework, hasNotesExample, migrationModule } from "./helpers"

export const apiKeys: Capability = {
  name: "api-keys",
  describe: "Scoped machine-to-machine API keys (non-human credentials)",
  apply(ctx, plan) {
    addPlatformPackage(plan, ctx, "api-keys", { api: true })
    plan.create("scripts/migrations.d/api-keys.ts", migrationModule("api-keys"), "api-keys migrations wiring")

    if (ctx.hasApp("api")) {
      plan.create("apps/api/src/platform/api-keys.ts", CLIENT, "api-keys client")
      const hono = apiFramework(ctx) === "hono"
      const notes = hasNotesExample(ctx)
      plan.create("apps/api/src/routes/machine.ts", hono ? routeHono(notes) : routeExpress(notes), "scope-protected machine route")
    }

    plan.addEnvVar({
      name: "API_KEYS_PEPPER",
      example: "change-me-to-a-long-random-secret",
      comment: "REQUIRED — api-keys won't work without it; keep out of the DB",
      secret: true,
    })

    plan.patchManifest({ platform: { "api-keys": true } })
    plan.nextStep("Run `pnpm migrate` and set API_KEYS_PEPPER. Issue keys via apiKeys.create({ workspaceId, name, scopes }).")
  },
}

const CLIENT = `import { createApiKeysClient, pgAdapter } from "@obh/api-keys"
import { pool } from "../db"

export const apiKeys = createApiKeysClient({
  db: pgAdapter(pool),
  pepper: process.env.API_KEYS_PEPPER!,
})
`

function routeHono(notes: boolean): string {
  const body = notes
    ? `    const body = await c.req.json<{ title?: string; body?: string }>()
    if (!body.title) return c.json({ error: "title is required" }, 400)
    return c.json(await notes.createNote({ title: body.title, body: body.body }), 201)`
    : `    return c.json({ ok: true, principal: ctx.principalId })`
  return `import type { Hono } from "hono"
import { ApiKeyAuthError } from "@obh/api-keys"
import { apiKeys } from "../platform/api-keys"
${notes ? 'import * as notes from "../domain/notes"\n' : ""}
export function register(app: Hono): void {
  app.post("/machine/${notes ? "notes" : "ping"}", async (c) => {
    const bearer = (c.req.header("authorization") ?? "").replace(/^Bearer /, "")
    let ctx
    try {
      ctx = await apiKeys.authenticate(bearer)
    } catch (err) {
      if (err instanceof ApiKeyAuthError) return c.json({ error: "invalid api key" }, 401)
      throw err
    }
    if (!apiKeys.hasScope(ctx, "${notes ? "notes:write" : "machine:use"}")) {
      return c.json({ error: "missing scope" }, 403)
    }
${body}
  })
}
`
}

function routeExpress(notes: boolean): string {
  const body = notes
    ? `    if (!req.body.title) return res.status(400).json({ error: "title is required" })
    res.status(201).json(await notes.createNote({ title: req.body.title, body: req.body.body }))`
    : `    res.json({ ok: true, principal: ctx.principalId })`
  return `import type { Express, Request, Response } from "express"
import { ApiKeyAuthError } from "@obh/api-keys"
import { apiKeys } from "../platform/api-keys"
${notes ? 'import * as notes from "../domain/notes"\n' : ""}
export function register(app: Express): void {
  app.post("/machine/${notes ? "notes" : "ping"}", async (req: Request, res: Response) => {
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "")
    let ctx
    try {
      ctx = await apiKeys.authenticate(bearer)
    } catch (err) {
      if (err instanceof ApiKeyAuthError) return res.status(401).json({ error: "invalid api key" })
      throw err
    }
    if (!apiKeys.hasScope(ctx, "${notes ? "notes:write" : "machine:use"}")) {
      return res.status(403).json({ error: "missing scope" })
    }
${body}
  })
}
`
}
