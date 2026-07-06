import { spawn } from "node:child_process"

/**
 * Run a command, streaming stdio to the terminal. Used sparingly — Forge is a
 * file generator, not a task runner. Returns the exit code.
 */
export function run(cmd: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" })
    child.on("error", reject)
    child.on("close", (code) => resolve(code ?? 0))
  })
}
