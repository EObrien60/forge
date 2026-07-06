import path from "node:path"
import { exists } from "../utils/fs"

/**
 * Resolve the project root by walking up from `start` looking for forge.json,
 * then pnpm-workspace.yaml, then package.json. Falls back to `start`.
 */
export async function findProjectRoot(start: string): Promise<string> {
  let dir = path.resolve(start)
  // Walk upward a bounded number of levels.
  for (let i = 0; i < 20; i++) {
    if (await exists(path.join(dir, "forge.json"))) return dir
    if (await exists(path.join(dir, "pnpm-workspace.yaml"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return path.resolve(start)
}

/** Absolute path for a repo-relative path within the project. */
export function abs(root: string, relative: string): string {
  return path.join(root, relative)
}

export const paths = {
  forgeManifest: "forge.json",
  rootPackageJson: "package.json",
  pnpmWorkspace: "pnpm-workspace.yaml",
  tsconfigBase: "tsconfig.base.json",
  envExample: ".env.example",
  ci: ".github/workflows/ci.yml",
  readme: "README.md",
  agents: "AGENTS.md",
  migrationsDir: "migrations",
  migrateScript: "scripts/migrate.ts",
  app: (name: string) => `apps/${name}`,
  pkg: (name: string) => `packages/${name}`,
  deploy: (name: string) => `deploy/${name}.lwd.toml`,
  dockerfile: (name: string) => `docker/${name}.Dockerfile`,
} as const
