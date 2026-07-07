import path from "node:path"
import type { StackManifest } from "./types"
import { readJson, writeJson } from "../utils/fs"
import { paths } from "../project/paths"

export const STACK_VERSION = "0.1.0"
const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]*$/

export async function loadStackManifest(root: string): Promise<StackManifest | undefined> {
  return readJson<StackManifest>(path.join(root, paths.stackManifest))
}

export async function saveStackManifest(root: string, manifest: StackManifest): Promise<void> {
  await writeJson(path.join(root, paths.stackManifest), manifest)
}

/**
 * Validate a stack manifest. Returns a list of human-readable problems (empty =
 * valid): unique app names; every order/apps/sharedWith/service ref resolves;
 * every connection ${NAME} resolves to a generate key; secret names well-formed.
 */
export function validateStackManifest(m: StackManifest): string[] {
  const errors: string[] = []
  const appNames = new Set(m.apps.map((a) => a.name))

  if (m.apps.length !== appNames.size) errors.push("duplicate app names")
  for (const name of m.order) {
    if (!appNames.has(name)) errors.push(`order references unknown app "${name}"`)
  }
  if (m.order.length !== m.apps.length) {
    errors.push(`order lists ${m.order.length} apps but ${m.apps.length} are declared`)
  }

  const checkSecretName = (name: string): void => {
    if (!SECRET_NAME_RE.test(name)) errors.push(`invalid secret name "${name}" (want ^[A-Z][A-Z0-9_]*$)`)
  }

  const generateKeys = new Set(Object.keys(m.secrets.generate))
  for (const [name, g] of Object.entries(m.secrets.generate)) {
    checkSecretName(name)
    for (const app of g.apps) if (!appNames.has(app)) errors.push(`generate.${name} targets unknown app "${app}"`)
    if (g.bytes <= 0) errors.push(`generate.${name} needs bytes > 0`)
  }

  for (const [name, c] of Object.entries(m.secrets.connections)) {
    checkSecretName(name)
    if (!appNames.has(c.service.app)) errors.push(`connections.${name}.service.app unknown app "${c.service.app}"`)
    for (const app of c.apps) if (!appNames.has(app)) errors.push(`connections.${name} targets unknown app "${app}"`)
    for (const app of c.sharedWith ?? []) {
      if (!appNames.has(app)) errors.push(`connections.${name}.sharedWith unknown app "${app}"`)
    }
    for (const ref of templateRefs(c.template)) {
      if (!generateKeys.has(ref)) errors.push(`connections.${name} references \${${ref}} which is not a generate secret`)
    }
  }

  for (const name of m.secrets.manual) checkSecretName(name)
  return errors
}

/** All ${NAME} references in a connection template. */
export function templateRefs(template: string): string[] {
  const out: string[] = []
  const re = /\$\{([A-Z][A-Z0-9_]*)\}/g
  let match: RegExpExecArray | null
  while ((match = re.exec(template)) !== null) out.push(match[1])
  return out
}

/** Substitute ${NAME} refs in a template from a values map. */
export function resolveTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_, name: string) => values[name] ?? `\${${name}}`)
}
