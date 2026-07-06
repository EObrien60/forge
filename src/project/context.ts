import path from "node:path"
import type { AppRecord, CapabilityName, ForgeManifest } from "../types"
import { listDirs, readJson } from "../utils/fs"
import { loadManifest } from "./manifest"
import { findProjectRoot } from "./paths"

/**
 * A read model of the project Forge is operating on. Commands load one of these,
 * build a Plan against it, and apply. It never mutates anything itself.
 */
export class ProjectContext {
  constructor(
    readonly root: string,
    readonly manifest: ForgeManifest | undefined,
    readonly rootPkg: Record<string, any> | undefined,
    readonly appDirs: string[],
    readonly packageDirs: string[],
  ) {}

  static async load(cwd: string): Promise<ProjectContext> {
    const root = await findProjectRoot(cwd)
    const manifest = await loadManifest(root)
    const rootPkg = await readJson<Record<string, any>>(path.join(root, "package.json"))
    const appDirs = await listDirs(path.join(root, "apps"))
    const packageDirs = await listDirs(path.join(root, "packages"))
    return new ProjectContext(root, manifest, rootPkg, appDirs, packageDirs)
  }

  hasManifest(): boolean {
    return this.manifest !== undefined
  }

  requireManifest(): ForgeManifest {
    if (!this.manifest) {
      throw new Error(
        "No forge.json found. Run this inside a Forge project, or create one with `forge new app <name>`.",
      )
    }
    return this.manifest
  }

  hasCapability(name: CapabilityName): boolean {
    return this.manifest?.platform?.[name] === true
  }

  /** True if an app directory of this name exists on disk. */
  hasApp(name: string): boolean {
    return this.appDirs.includes(name)
  }

  /** The first app with the given role recorded in the manifest, if any. */
  appByRole(role: AppRecord["role"]): AppRecord | undefined {
    const apps = this.manifest?.apps ?? {}
    return Object.values(apps).find((a) => a.role === role)
  }

  /** True if a worker app exists (on disk or in the manifest). */
  hasWorker(): boolean {
    return this.hasApp("worker") || this.appByRole("worker") !== undefined
  }
}
