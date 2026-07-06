import path from "node:path"
import type { ForgeManifest, Topology } from "../types"
import { FORGE_VERSION } from "../version"
import { readJson, writeJson } from "../utils/fs"
import { paths } from "./paths"

/** Build a fresh manifest for a brand-new project. */
export function newManifest(name: string, createdAt: string, topology: Topology): ForgeManifest {
  return {
    name,
    forgeVersion: FORGE_VERSION,
    createdAt,
    packageManager: "pnpm",
    runtime: "node20",
    apps: {},
    packages: {},
    platform: {},
    deploy: { target: "lwd", topology },
  }
}

/** Load forge.json from a project root, or undefined if absent/invalid. */
export async function loadManifest(root: string): Promise<ForgeManifest | undefined> {
  return readJson<ForgeManifest>(path.join(root, paths.forgeManifest))
}

/** Persist forge.json. */
export async function saveManifest(root: string, manifest: ForgeManifest): Promise<void> {
  await writeJson(path.join(root, paths.forgeManifest), manifest)
}

/**
 * Merge a partial manifest patch into a base manifest. Shallow-merges the
 * top-level records (apps/packages/platform) so capabilities can add entries
 * without clobbering existing ones.
 */
export function mergeManifest(base: ForgeManifest, patch: DeepPartial<ForgeManifest>): ForgeManifest {
  return {
    ...base,
    ...stripRecords(patch),
    apps: { ...base.apps, ...(patch.apps as ForgeManifest["apps"]) },
    packages: { ...base.packages, ...(patch.packages as ForgeManifest["packages"]) },
    platform: { ...base.platform, ...(patch.platform as ForgeManifest["platform"]) },
    deploy: { ...base.deploy, ...(patch.deploy as ForgeManifest["deploy"]) },
  }
}

function stripRecords(patch: DeepPartial<ForgeManifest>): Partial<ForgeManifest> {
  const { apps, packages, platform, deploy, ...rest } = patch
  return rest as Partial<ForgeManifest>
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}
