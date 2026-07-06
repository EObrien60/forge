// Central type contracts for OBH Forge.
// Keep this file the single source of truth for shapes that cross module boundaries.

/** Backend framework for a generated API app. */
export type ApiFramework = "hono" | "express"

/** How an app is built/served. */
export type WebFramework = "vite-react"

/** Deployment target. Only lwd is first-class today. */
export type DeployTarget = "lwd"

/** lwd deployment topology (see §14 of the spec). */
export type Topology = "small" | "split"

/** The OBH platform primitives Forge can install. */
export type CapabilityName =
  | "events"
  | "jobs"
  | "files"
  | "audit"
  | "settings"
  | "api-keys"
  | "webhooks"
  | "import-export"
  | "entitlements"
  | "search"
  | "analytics"
  | "notifications"

/** Recipes are ordered bundles of scaffolding operations. */
export type RecipeName =
  | "full-saas"
  | "api-web-worker"
  | "api-only"
  | "worker"
  | "platform-package"

/** A deployable application inside a project. */
export interface AppRecord {
  /** Directory name under apps/, e.g. "api". */
  name: string
  /** Repo-relative path, e.g. "apps/api". */
  path: string
  /** Present for API apps. */
  framework?: ApiFramework | WebFramework
  /** Role hint used by generators and doctor. */
  role: "api" | "web" | "worker" | "mobile"
}

/** A shared internal package inside a project. */
export interface PackageRecord {
  name: string
  path: string
}

/** The forge.json project manifest (see §18). A record and aid — never a reconciler contract. */
export interface ForgeManifest {
  name: string
  forgeVersion: string
  createdAt: string
  packageManager: "pnpm"
  runtime: "node20"
  apps: Record<string, AppRecord>
  packages: Record<string, PackageRecord>
  platform: Partial<Record<CapabilityName, boolean>>
  deploy: {
    target: DeployTarget
    topology: Topology
  }
}

/** How a file operation is classified for safety (see §21). */
export type FileOpKind =
  /** Write only if the file does not already exist. */
  | "create"
  /** Insert a clearly-marked section; idempotent via its marker. */
  | "append"
  /** Replace an existing file's contents (requires --force / confirmation). */
  | "overwrite"

/** A single planned change to a file. */
export interface FileOp {
  kind: FileOpKind
  /** Repo-relative path. */
  path: string
  /** Full contents for create/overwrite. */
  content?: string
  /** For append: a unique marker so re-runs are idempotent. */
  marker?: string
  /** For append: the section body inserted after the marker. */
  section?: string
  /** Human-readable one-liner shown in dry-run output. */
  describe: string
}

/** A dependency to add to the target app/package package.json. */
export interface DepAdd {
  /** Repo-relative dir whose package.json gets the dependency (default: project root). */
  target: string
  name: string
  version: string
  dev?: boolean
}

/** An environment variable to document in .env.example. */
export interface EnvVar {
  name: string
  /** Example / placeholder value; never a real secret. */
  example: string
  comment?: string
  /** If true, listed as an lwd secret name (value set out-of-band). */
  secret?: boolean
}

/** A script to add to the root package.json. */
export interface ScriptAdd {
  name: string
  command: string
}

/** The outcome of applying a plan, per op. */
export type ApplyResult = "created" | "appended" | "overwritten" | "skipped" | "conflict"
