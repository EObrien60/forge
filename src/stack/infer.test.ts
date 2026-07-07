import { describe, expect, it } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { inferStack } from "./infer"

const API = `name = "golinks-api"
domain = "go.example.com"
port = 8080
secrets = ["DATABASE_URL", "JWT_SECRET", "API_KEYS_PEPPER"]
[git]
url = "https://github.com/acme/golinks"
path = "apps/api"
[[services]]
name = "db"
image = "postgres:16"
env = { POSTGRES_USER = "golinks", POSTGRES_DB = "golinks" }
secrets = ["POSTGRES_PASSWORD"]
volume = "db-data:/var/lib/postgresql/data"
`
const WORKER = `name = "golinks-worker"
domain = "worker.example.com"
port = 8080
secrets = ["DATABASE_URL"]
[git]
url = "https://github.com/acme/golinks"
path = "apps/worker"
`
const ADMIN = `name = "golinks-admin"
domain = "links.example.com"
port = 80
[git]
url = "https://github.com/acme/golinks"
path = "."
`
const FORGE = JSON.stringify({
  name: "golinks",
  apps: { api: { role: "api" }, worker: { role: "worker" }, admin: { role: "web" } },
})

function fixture(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-stack-"))
  mkdirSync(path.join(root, "deploy"))
  writeFileSync(path.join(root, "deploy", "api.lwd.toml"), API)
  writeFileSync(path.join(root, "deploy", "worker.lwd.toml"), WORKER)
  writeFileSync(path.join(root, "deploy", "admin.lwd.toml"), ADMIN)
  writeFileSync(path.join(root, "forge.json"), FORGE)
  return root
}

describe("inferStack (golinks, small topology)", () => {
  it("groups apps in resource→api→worker→web order", async () => {
    const m = await inferStack(fixture())
    expect(m.name).toBe("golinks")
    expect(m.apps.map((a) => a.name)).toEqual(["golinks-admin", "golinks-api", "golinks-worker"]) // alpha by file
    expect(m.apps.find((a) => a.name === "golinks-api")?.role).toBe("api")
    expect(m.order).toEqual(["golinks-api", "golinks-worker", "golinks-admin"])
  })

  it("proposes generated secrets from the backing service + random app secrets", async () => {
    const m = await inferStack(fixture())
    expect(m.secrets.generate.POSTGRES_PASSWORD).toEqual({ type: "password", bytes: 24, apps: ["golinks-api"] })
    expect(m.secrets.generate.JWT_SECRET).toEqual({ type: "hex", bytes: 32, apps: ["golinks-api"] })
    expect(m.secrets.generate.API_KEYS_PEPPER).toEqual({ type: "hex", bytes: 32, apps: ["golinks-api"] })
    expect(m.secrets.manual).toEqual([])
  })

  it("derives DATABASE_URL and records the worker as a cross-app consumer", async () => {
    const m = await inferStack(fixture())
    const c = m.secrets.connections.DATABASE_URL
    expect(c.template).toBe("postgres://golinks:${POSTGRES_PASSWORD}@db:5432/golinks")
    expect(c.service).toEqual({ app: "golinks-api", name: "db" })
    expect(c.apps).toEqual(["golinks-api"])
    expect(c.sharedWith).toEqual(["golinks-worker"])
  })
})
