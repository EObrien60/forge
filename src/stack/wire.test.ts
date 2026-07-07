import { describe, expect, it, vi } from "vitest"
import type { StackManifest } from "./types"
import type { LwdToml } from "./lwdtoml"
import type { LwdAdapter } from "./lwd"
import { executeStackDeploy, planSecrets, printStackPlan } from "./wire"

function toml(name: string, secrets: string[]): LwdToml {
  return { name, env: {}, secrets, services: [] }
}

const APPS_SMALL: StackManifest["apps"] = [
  { name: "golinks-api", manifest: "deploy/api.lwd.toml", role: "api" },
  { name: "golinks-worker", manifest: "deploy/worker.lwd.toml", role: "worker" },
  { name: "golinks-admin", manifest: "deploy/admin.lwd.toml", role: "web" },
]

const small: StackManifest = {
  name: "golinks",
  stackVersion: "0.1.0",
  apps: APPS_SMALL,
  order: ["golinks-api", "golinks-worker", "golinks-admin"],
  secrets: {
    generate: {
      POSTGRES_PASSWORD: { type: "password", bytes: 24, apps: ["golinks-api"] },
      JWT_SECRET: { type: "hex", bytes: 32, apps: ["golinks-api"] },
    },
    connections: {
      DATABASE_URL: {
        template: "postgres://golinks:${POSTGRES_PASSWORD}@db:5432/golinks",
        service: { app: "golinks-api", name: "db" },
        apps: ["golinks-api"],
        sharedWith: ["golinks-worker"],
      },
    },
    manual: [],
  },
}

const tomls: Record<string, LwdToml> = {
  "golinks-api": toml("golinks-api", ["DATABASE_URL", "JWT_SECRET"]),
  "golinks-worker": toml("golinks-worker", ["DATABASE_URL"]),
  "golinks-admin": toml("golinks-admin", []),
}

const empty = { "golinks-api": [], "golinks-worker": [], "golinks-admin": [] }

describe("planSecrets — derivation + connectivity", () => {
  it("derives DATABASE_URL for the owner and flags the cross-app worker (co-located db)", () => {
    const plan = planSecrets(small, tomls, empty)
    const apiDb = plan.items.find((i) => i.app === "golinks-api" && i.key === "DATABASE_URL")
    expect(apiDb?.action).toBe("derive")
    expect(apiDb?.value).toMatch(/^postgres:\/\/golinks:[^@]+@db:5432\/golinks$/)

    const workerDb = plan.items.find((i) => i.app === "golinks-worker" && i.key === "DATABASE_URL")
    expect(workerDb?.action).toBe("blocked")
    expect(plan.flags.some((f) => f.includes("golinks-worker") && f.includes("can't reach"))).toBe(true)
  })

  it("passes the same connection in split topology (dedicated resource db app)", () => {
    const split: StackManifest = {
      ...small,
      apps: [
        { name: "golinks-db", manifest: "deploy/db.lwd.toml", role: "resource" },
        ...APPS_SMALL,
      ],
      order: ["golinks-db", "golinks-api", "golinks-worker", "golinks-admin"],
      secrets: {
        generate: { POSTGRES_PASSWORD: { type: "password", bytes: 24, apps: ["golinks-db"] } },
        connections: {
          DATABASE_URL: {
            template: "postgres://golinks:${POSTGRES_PASSWORD}@golinks-db:5432/golinks",
            service: { app: "golinks-db", name: "golinks-db" },
            apps: ["golinks-api", "golinks-worker"],
          },
        },
        manual: [],
      },
    }
    const plan = planSecrets(split, tomls, { ...empty, "golinks-db": [] })
    expect(plan.flags).toEqual([])
    expect(plan.items.find((i) => i.app === "golinks-worker" && i.key === "DATABASE_URL")?.action).toBe("derive")
  })

  it("is idempotent: existing secrets are skipped", () => {
    const plan = planSecrets(small, tomls, {
      ...empty,
      "golinks-api": ["POSTGRES_PASSWORD", "JWT_SECRET", "DATABASE_URL"],
    })
    expect(plan.items.find((i) => i.app === "golinks-api" && i.key === "POSTGRES_PASSWORD")?.action).toBe("skip")
    expect(plan.items.find((i) => i.app === "golinks-api" && i.key === "DATABASE_URL")?.action).toBe("skip")
  })

  it("--rotate regenerates the component AND re-derives its connections", () => {
    const plan = planSecrets(
      small,
      tomls,
      { ...empty, "golinks-api": ["POSTGRES_PASSWORD", "JWT_SECRET", "DATABASE_URL"] },
      { rotate: ["POSTGRES_PASSWORD"] },
    )
    expect(plan.items.find((i) => i.app === "golinks-api" && i.key === "POSTGRES_PASSWORD")?.action).toBe("generate")
    expect(plan.items.find((i) => i.app === "golinks-api" && i.key === "DATABASE_URL")?.action).toBe("derive")
  })

  it("flags manual secrets an app needs but hasn't got", () => {
    const withManual: StackManifest = { ...small, secrets: { ...small.secrets, manual: ["EXTERNAL_TOKEN"] } }
    const t = { ...tomls, "golinks-api": toml("golinks-api", ["DATABASE_URL", "JWT_SECRET", "EXTERNAL_TOKEN"]) }
    const plan = planSecrets(withManual, t, empty)
    expect(plan.items.find((i) => i.key === "EXTERNAL_TOKEN")?.action).toBe("manual-missing")
  })
})

describe("executeStackDeploy — ordering + guards", () => {
  function mockAdapter(calls: string[]): LwdAdapter {
    return {
      secretLs: async () => [],
      secretSet: async (app, key) => void calls.push(`set:${app}:${key}`),
      apply: async (m) => void calls.push(`apply:${m}`),
      status: async (app) => ({ app, healthy: true, state: "running" }),
      rm: async () => {},
    }
  }

  it("sets secrets then applies each app in order", async () => {
    const calls: string[] = []
    // Use split so nothing is blocked.
    const split: StackManifest = {
      ...small,
      apps: [{ name: "golinks-db", manifest: "deploy/db.lwd.toml", role: "resource" }, ...APPS_SMALL],
      order: ["golinks-db", "golinks-api", "golinks-worker", "golinks-admin"],
      secrets: {
        generate: { POSTGRES_PASSWORD: { type: "password", bytes: 24, apps: ["golinks-db"] } },
        connections: {},
        manual: [],
      },
    }
    const plan = planSecrets(split, tomls, { ...empty, "golinks-db": [] })
    await executeStackDeploy("/x", split, mockAdapter(calls), plan, { noWait: true })
    const applies = calls.filter((c) => c.startsWith("apply:"))
    expect(applies).toEqual([
      "apply:deploy/db.lwd.toml",
      "apply:deploy/api.lwd.toml",
      "apply:deploy/worker.lwd.toml",
      "apply:deploy/admin.lwd.toml",
    ])
    expect(calls).toContain("set:golinks-db:POSTGRES_PASSWORD")
  })

  it("aborts an app whose manual secret is unset (nothing applied for it)", async () => {
    const calls: string[] = []
    const withManual: StackManifest = {
      ...small,
      order: ["golinks-api"],
      apps: [APPS_SMALL[0]],
      secrets: { generate: {}, connections: {}, manual: ["EXTERNAL_TOKEN"] },
    }
    const t = { "golinks-api": toml("golinks-api", ["EXTERNAL_TOKEN"]) }
    const plan = planSecrets(withManual, t, { "golinks-api": [] })
    await expect(executeStackDeploy("/x", withManual, mockAdapter(calls), plan, { noWait: true })).rejects.toThrow()
    expect(calls.filter((c) => c.startsWith("apply:"))).toEqual([])
  })
})

describe("printStackPlan — masks values", () => {
  it("never prints a generated/derived value", () => {
    const plan = planSecrets(small, tomls, empty)
    const values = plan.items.filter((i) => i.value).map((i) => i.value as string)
    expect(values.length).toBeGreaterThan(0)

    const out: string[] = []
    const spies = ["log", "warn", "error"].map((m) =>
      vi.spyOn(console, m as "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" "))),
    )
    printStackPlan(small, plan)
    spies.forEach((s) => s.mockRestore())

    const text = out.join("\n")
    for (const v of values) expect(text).not.toContain(v)
  })
})
