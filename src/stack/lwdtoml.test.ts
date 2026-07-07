import { describe, expect, it } from "vitest"
import { parseLwdToml } from "./lwdtoml"

const API_TOML = `name    = "golinks-api"
domain  = "go.obhsoftware.ie"
port    = 8080
env     = { NODE_ENV = "production", LOG_LEVEL = "info" }
secrets = ["DATABASE_URL", "JWT_SECRET", "API_KEYS_PEPPER"]

[git]
url  = "https://github.com/EObrien60/golinks"
ref  = "main"
path = "apps/api"

[build]
dockerfile = "Dockerfile"

[health]
path    = "/health"
timeout = "30s"

[[services]]
name    = "db"
image   = "postgres:16"
env     = { POSTGRES_USER = "golinks", POSTGRES_DB = "golinks" }
secrets = ["POSTGRES_PASSWORD"]
volume  = "db-data:/var/lib/postgresql/data"
`

describe("parseLwdToml", () => {
  it("parses name, port, secrets, git, and backing services", () => {
    const t = parseLwdToml(API_TOML)
    expect(t.name).toBe("golinks-api")
    expect(t.port).toBe(8080)
    expect(t.secrets).toEqual(["DATABASE_URL", "JWT_SECRET", "API_KEYS_PEPPER"])
    expect(t.git?.path).toBe("apps/api")
    expect(t.services).toHaveLength(1)
    const db = t.services[0]
    expect(db.name).toBe("db")
    expect(db.image).toBe("postgres:16")
    expect(db.env.POSTGRES_USER).toBe("golinks")
    expect(db.secrets).toEqual(["POSTGRES_PASSWORD"])
    expect(db.volume).toBe("db-data:/var/lib/postgresql/data")
  })

  it("defaults env/secrets/services to empty when absent", () => {
    const t = parseLwdToml('name = "x"\nport = 80\n')
    expect(t.env).toEqual({})
    expect(t.secrets).toEqual([])
    expect(t.services).toEqual([])
  })
})
