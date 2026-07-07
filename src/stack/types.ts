// The stack delivery contract: deploy/stack.json. Distinct from forge.json
// (a receipt) — this is the reviewable repo→lwd wiring plan.

export type AppRole = "api" | "web" | "worker" | "resource" | "app"

export interface StackApp {
  name: string
  /** Repo-relative path to the app's lwd.toml. */
  manifest: string
  role: AppRole
}

/** A secret whose value the tool generates and sets on `apps`. */
export interface GenerateSecret {
  type: "password" | "hex"
  bytes: number
  apps: string[]
}

/** A secret DERIVED from generated components via `template`. */
export interface ConnectionSecret {
  /** Shell-free string with ${NAME} refs into `generate` keys. */
  template: string
  /** The backing service this connection reaches (for reachability checks). */
  service: { app: string; name: string }
  /** Consumers KNOWN to reach the service (validated). */
  apps: string[]
  /** Requested cross-app consumers (validated → may be flagged). */
  sharedWith?: string[]
}

export interface StackSecrets {
  generate: Record<string, GenerateSecret>
  connections: Record<string, ConnectionSecret>
  /** Names the tool won't invent; the operator sets them. */
  manual: string[]
}

export interface StackManifest {
  name: string
  stackVersion: string
  apps: StackApp[]
  /** App names in dependency order for apply. */
  order: string[]
  secrets: StackSecrets
}

/** Health/state parsed from `lwd status <app>`. */
export interface AppStatus {
  app: string
  healthy: boolean
  state: string
}
