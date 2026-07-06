import type { Plan } from "../project/plan"

export interface SdkOptions {
  scope: string
}

/**
 * Generates the shared SDK package: the typed contract between backend and
 * frontends. This is the piece whose absence produced qMechanic's 3,200-line
 * defensive apiClient — so Forge makes it mandatory for any project with a
 * frontend.
 */
export function addSdkPackage(plan: Plan, opts: SdkOptions): void {
  const dir = "packages/sdk"

  plan.create(
    `${dir}/package.json`,
    JSON.stringify(
      {
        name: `${opts.scope}/sdk`,
        version: "0.1.0",
        private: true,
        main: "dist/index.js",
        types: "dist/index.d.ts",
        files: ["dist"],
        scripts: {
          build: "tsc -p tsconfig.json",
          typecheck: "tsc -p tsconfig.json --noEmit",
          test: "vitest run --passWithNoTests",
        },
        devDependencies: {
          typescript: "^5.5.4",
          vitest: "^2.0.5",
        },
      },
      null,
      2,
    ) + "\n",
    "SDK package.json",
  )

  plan.create(
    `${dir}/tsconfig.json`,
    JSON.stringify(
      {
        extends: "../../tsconfig.base.json",
        compilerOptions: { rootDir: "src", outDir: "dist" },
        include: ["src"],
        exclude: ["dist", "node_modules", "src/**/*.test.ts"],
      },
      null,
      2,
    ) + "\n",
    "SDK tsconfig",
  )

  plan.create(`${dir}/src/index.ts`, INDEX, "SDK entrypoint")
  plan.create(`${dir}/src/types.ts`, TYPES, "shared domain types")
  plan.create(`${dir}/src/client.ts`, CLIENT, "typed API client")
}

const INDEX = `// Public surface of the SDK — the one contract shared by API and frontends.
export * from "./types"
export { createClient } from "./client"
export type { Client, ClientOptions } from "./client"
`

const TYPES = `// Shared domain types. Define request/response shapes here ONCE so the API and
// every frontend agree — no defensive normalization needed on the client.

export interface HealthStatus {
  status: "ok" | "degraded"
}
`

const CLIENT = `import type { HealthStatus } from "./types"

export interface ClientOptions {
  baseUrl: string
  /** Optional bearer token provider. */
  token?: () => string | null
}

export interface Client {
  health(): Promise<HealthStatus>
}

/** A thin typed fetch client. Extend with one method per API resource. */
export function createClient(opts: ClientOptions): Client {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers)
    const token = opts.token?.()
    if (token) headers.set("authorization", "Bearer " + token)
    const res = await fetch(opts.baseUrl + path, { ...init, headers })
    if (!res.ok) throw new Error(path + " failed: " + res.status)
    return (await res.json()) as T
  }

  return {
    health: () => request<HealthStatus>("/health"),
  }
}
`
