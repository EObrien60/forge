#!/usr/bin/env node
import { Command } from "commander"
import { FORGE_VERSION } from "./version"
import { newCommand } from "./commands/new"
import { addCommand } from "./commands/add"
import { inspectCommand } from "./commands/inspect"
import { doctorCommand } from "./commands/doctor"
import { generateCommand } from "./commands/generate"

function withFlags(cmd: Command): Command {
  return cmd
    .option("--dry-run", "preview changes without writing")
    .option("-y, --yes", "skip the confirmation prompt")
    .option("--force", "overwrite existing files that differ")
}

const program = new Command()
program
  .name("forge")
  .description("OBH Forge — deterministic scaffolding & delivery tooling")
  .version(FORGE_VERSION)

withFlags(
  program
    .command("new <kind> [name]")
    .description("scaffold a new project (kind: app)")
    .option("--recipe <recipe>", "full-saas | api-web-worker | api-only | worker")
    .option("--scope <scope>", "npm scope for internal packages (default @<name>)")
    .option("--topology <topology>", "small | split"),
).action((kind: string, name: string | undefined, opts: Record<string, unknown>) => newCommand(kind, name, opts))

withFlags(
  program
    .command("add <target> [name]")
    .description("add a capability (events|jobs|files|audit) or app (api|web|worker|sdk)"),
).action((target: string, name: string | undefined, opts: Record<string, unknown>) => addCommand(target, name, opts))

program.command("inspect").description("report project shape and detected conventions").action(() => inspectCommand())

program.command("doctor").description("check the project against OBH conventions").action(() => doctorCommand())

withFlags(
  program.command("generate <artifact>").description("regenerate an artifact (v1: lwd)"),
).action((artifact: string, opts: Record<string, unknown>) => generateCommand(artifact, opts))

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
