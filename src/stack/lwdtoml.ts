import { readFileSafe } from "../utils/fs"

// @iarna/toml is CommonJS; require sidesteps its empty `types` field. It parses
// the subset lwd uses (inline tables, arrays-of-tables, comments).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const TOML = require("@iarna/toml") as { parse(s: string): Record<string, unknown> }

export interface LwdService {
  name: string
  image: string
  command?: string
  env: Record<string, string>
  secrets: string[]
  volume?: string
}

export interface LwdToml {
  name: string
  domain?: string
  port?: number
  image?: string
  env: Record<string, string>
  secrets: string[]
  replicas?: number
  compose?: string
  service?: string
  git?: { url: string; ref?: string; path?: string }
  build?: { dockerfile?: string; context?: string }
  health?: { path?: string; timeout?: string }
  services: LwdService[]
}

function strMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = String(val)
  }
  return out
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : []
}

/** Parse an lwd.toml string into a typed, normalised shape. */
export function parseLwdToml(content: string): LwdToml {
  const raw = TOML.parse(content) as Record<string, any>
  const services: LwdService[] = Array.isArray(raw.services)
    ? raw.services.map((s: Record<string, unknown>) => ({
        name: String(s.name),
        image: String(s.image),
        command: s.command !== undefined ? String(s.command) : undefined,
        env: strMap(s.env),
        secrets: strList(s.secrets),
        volume: s.volume !== undefined ? String(s.volume) : undefined,
      }))
    : []

  return {
    name: String(raw.name ?? ""),
    domain: raw.domain !== undefined ? String(raw.domain) : undefined,
    port: typeof raw.port === "number" ? raw.port : undefined,
    image: raw.image !== undefined ? String(raw.image) : undefined,
    env: strMap(raw.env),
    secrets: strList(raw.secrets),
    replicas: typeof raw.replicas === "number" ? raw.replicas : undefined,
    compose: raw.compose !== undefined ? String(raw.compose) : undefined,
    service: raw.service !== undefined ? String(raw.service) : undefined,
    git: raw.git ? { url: String(raw.git.url), ref: raw.git.ref, path: raw.git.path } : undefined,
    build: raw.build ? { dockerfile: raw.build.dockerfile, context: raw.build.context } : undefined,
    health: raw.health ? { path: raw.health.path, timeout: raw.health.timeout } : undefined,
    services,
  }
}

/** Read + parse an lwd.toml file, or undefined if it does not exist. */
export async function readLwdToml(absPath: string): Promise<LwdToml | undefined> {
  const content = await readFileSafe(absPath)
  if (content === undefined) return undefined
  return parseLwdToml(content)
}
