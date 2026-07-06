import pc from "picocolors"

/**
 * Tiny leveled logger. Boring on purpose: writes plain lines to stdout/stderr.
 * Forge is a CLI, so this is the whole logging story.
 */
export interface Logger {
  info(msg: string): void
  step(msg: string): void
  success(msg: string): void
  warn(msg: string): void
  error(msg: string): void
  dim(msg: string): void
  plain(msg: string): void
}

export function createLogger(): Logger {
  return {
    info: (m) => console.log(pc.blue("·") + " " + m),
    step: (m) => console.log(pc.cyan("→") + " " + m),
    success: (m) => console.log(pc.green("✓") + " " + m),
    warn: (m) => console.warn(pc.yellow("!") + " " + m),
    error: (m) => console.error(pc.red("✗") + " " + m),
    dim: (m) => console.log(pc.dim(m)),
    plain: (m) => console.log(m),
  }
}

export const log = createLogger()
