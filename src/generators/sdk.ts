import type { ExampleDomain } from "../types"
import type { Plan } from "../project/plan"

export interface SdkOptions {
  scope: string
  example: ExampleDomain
}

/**
 * Generates the shared SDK package: the typed contract between backend and
 * frontends. This is the piece whose absence produced qMechanic's 3,200-line
 * defensive apiClient, so Forge makes it the one place request/response shapes
 * are defined.
 */
export function addSdkPackage(plan: Plan, opts: SdkOptions): void {
  const dir = "packages/sdk"
  const notes = opts.example === "notes"

  plan.create(
    `${dir}/package.json`,
    JSON.stringify(
      {
        name: `${opts.scope}/sdk`,
        version: "0.1.0",
        private: true,
        // ESM so Vite/Rollup can tree-shake the named exports (a CommonJS SDK
        // breaks `vite build` in a consuming frontend).
        type: "module",
        main: "dist/index.js",
        module: "dist/index.js",
        types: "dist/index.d.ts",
        files: ["dist"],
        scripts: {
          build: "tsc -p tsconfig.json",
          typecheck: "tsc -p tsconfig.json --noEmit",
          test: "vitest run --passWithNoTests",
        },
        devDependencies: { typescript: "^5.5.4", vitest: "^2.0.5" },
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
        // Self-contained + ESM so frontends bundle it cleanly (and it builds in
        // any Docker context without the repo-root base tsconfig).
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          lib: ["ES2022", "DOM"],
          rootDir: "src",
          outDir: "dist",
          declaration: true,
          sourceMap: true,
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          resolveJsonModule: true,
        },
        include: ["src"],
        exclude: ["dist", "node_modules", "src/**/*.test.ts"],
      },
      null,
      2,
    ) + "\n",
    "SDK tsconfig",
  )

  plan.create(`${dir}/src/index.ts`, INDEX, "SDK entrypoint")
  plan.create(`${dir}/src/types.ts`, notes ? TYPES_NOTES : TYPES_BASE, "shared domain types")
  plan.create(`${dir}/src/client.ts`, notes ? CLIENT_NOTES : CLIENT_BASE, "typed API client")
}

const INDEX = `// Public surface of the SDK — the one contract shared by API and frontends.
export * from "./types"
export { createClient } from "./client"
export type { Client, ClientOptions } from "./client"
`

const TYPES_BASE = `export interface HealthStatus {
  status: "ok" | "degraded"
}
`

const TYPES_NOTES = `export interface HealthStatus {
  status: "ok" | "degraded"
}

export interface Note {
  id: string
  title: string
  body: string
  createdAt: string
  updatedAt: string
}

export interface CreateNoteInput {
  title: string
  body?: string
}

export interface UpdateNoteInput {
  title?: string
  body?: string
}
`

const CLIENT_HEAD = `import type { HealthStatus } from "./types"

export interface ClientOptions {
  baseUrl: string
  /** Optional bearer token provider. */
  token?: () => string | null
}

async function request<T>(opts: ClientOptions, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body) headers.set("content-type", "application/json")
  const token = opts.token?.()
  if (token) headers.set("authorization", "Bearer " + token)
  const res = await fetch(opts.baseUrl + path, { ...init, headers })
  if (!res.ok) throw new Error(path + " failed: " + res.status)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
`

const CLIENT_BASE = `${CLIENT_HEAD}
export interface Client {
  health(): Promise<HealthStatus>
}

/** A thin typed fetch client. Add one method per API resource. */
export function createClient(opts: ClientOptions): Client {
  return {
    health: () => request<HealthStatus>(opts, "/health"),
  }
}
`

const CLIENT_NOTES = `import type { CreateNoteInput, Note, UpdateNoteInput } from "./types"
${CLIENT_HEAD}
export interface Client {
  health(): Promise<HealthStatus>
  notes: {
    list(): Promise<Note[]>
    get(id: string): Promise<Note>
    create(input: CreateNoteInput): Promise<Note>
    update(id: string, input: UpdateNoteInput): Promise<Note>
    remove(id: string): Promise<void>
  }
}

/** A thin typed fetch client — the single contract shared with every frontend. */
export function createClient(opts: ClientOptions): Client {
  return {
    health: () => request<HealthStatus>(opts, "/health"),
    notes: {
      list: () => request<Note[]>(opts, "/notes"),
      get: (id) => request<Note>(opts, "/notes/" + id),
      create: (input) => request<Note>(opts, "/notes", { method: "POST", body: JSON.stringify(input) }),
      update: (id, input) => request<Note>(opts, "/notes/" + id, { method: "PUT", body: JSON.stringify(input) }),
      remove: (id) => request<void>(opts, "/notes/" + id, { method: "DELETE" }),
    },
  }
}
`
