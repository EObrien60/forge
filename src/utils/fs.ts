import { promises as fs } from "node:fs"
import path from "node:path"

/** Does a path exist? */
export async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

/** Read a file as UTF-8, or return undefined if it does not exist. */
export async function readFileSafe(p: string): Promise<string | undefined> {
  try {
    return await fs.readFile(p, "utf8")
  } catch {
    return undefined
  }
}

/** Read + parse JSON, or undefined if missing/invalid. */
export async function readJson<T>(p: string): Promise<T | undefined> {
  const raw = await readFileSafe(p)
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

/** Write a file, creating parent directories as needed. */
export async function writeFile(p: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, content, "utf8")
}

/** Write pretty JSON with a trailing newline. */
export async function writeJson(p: string, value: unknown): Promise<void> {
  await writeFile(p, JSON.stringify(value, null, 2) + "\n")
}

/** List immediate subdirectory names of a directory (empty if it does not exist). */
export async function listDirs(p: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(p, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}
