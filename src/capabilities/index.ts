import type { CapabilityName } from "../types"
import type { Capability } from "./types"
import { events } from "./events"
import { jobs } from "./jobs"
import { files } from "./files"
import { audit } from "./audit"

export type { Capability } from "./types"

/** All capabilities Forge can install today. v1 ships events/jobs/files/audit. */
export const CAPABILITIES: Partial<Record<CapabilityName, Capability>> = {
  events,
  jobs,
  files,
  audit,
}

export function getCapability(name: CapabilityName): Capability | undefined {
  return CAPABILITIES[name]
}

export function isImplemented(name: CapabilityName): boolean {
  return CAPABILITIES[name] !== undefined
}

/**
 * Expand a requested set of capabilities to include their prerequisites, then
 * return them in dependency order (requires-before-dependents). Unknown names
 * are dropped by the caller after reporting.
 */
export function resolveOrder(requested: CapabilityName[]): CapabilityName[] {
  const ordered: CapabilityName[] = []
  const seen = new Set<CapabilityName>()

  const visit = (name: CapabilityName): void => {
    if (seen.has(name)) return
    seen.add(name)
    const cap = CAPABILITIES[name]
    if (!cap) return
    for (const req of cap.requires ?? []) visit(req)
    ordered.push(name)
  }

  for (const name of requested) visit(name)
  return ordered
}

/** Prerequisites of a capability that are not already installed/requested. */
export function missingPrerequisites(
  name: CapabilityName,
  installed: (n: CapabilityName) => boolean,
): CapabilityName[] {
  const cap = CAPABILITIES[name]
  if (!cap) return []
  return (cap.requires ?? []).filter((r) => !installed(r))
}
