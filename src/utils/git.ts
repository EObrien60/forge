import { execFile } from "node:child_process"
import { promisify } from "node:util"

const exec = promisify(execFile)

export interface GitRepo {
  /** "owner/repo" */
  slug: string
  /** Normalised https URL. */
  url: string
}

/**
 * Detect the GitHub repo from a directory's `origin` remote. Handles both
 * https and ssh forms. Returns undefined if the dir is not a git repo or has no
 * usable origin.
 */
export async function detectGitRepo(cwd: string): Promise<GitRepo | undefined> {
  let raw: string
  try {
    const { stdout } = await exec("git", ["remote", "get-url", "origin"], { cwd })
    raw = stdout.trim()
  } catch {
    return undefined
  }
  return parseRemote(raw)
}

/** Parse a git remote URL (https or ssh) into a GitHub slug + https URL. */
export function parseRemote(raw: string): GitRepo | undefined {
  const trimmed = raw.replace(/\.git$/, "").trim()
  // git@github.com:owner/repo  or  ssh://git@github.com/owner/repo
  const ssh = trimmed.match(/git@[^:]+:(.+)$/) ?? trimmed.match(/ssh:\/\/git@[^/]+\/(.+)$/)
  if (ssh?.[1]) return slugToRepo(ssh[1])
  // https://github.com/owner/repo
  const https = trimmed.match(/https?:\/\/[^/]+\/(.+)$/)
  if (https?.[1]) return slugToRepo(https[1])
  return undefined
}

/** Normalise an "owner/repo" slug (or full URL) into a GitRepo. */
export function slugToRepo(input: string): GitRepo | undefined {
  const parsed = input.startsWith("http") || input.startsWith("git@") ? parseRemote(input) : undefined
  if (parsed) return parsed
  const parts = input.split("/").filter(Boolean)
  if (parts.length < 2) return undefined
  const slug = `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
  return { slug, url: `https://github.com/${slug}` }
}
