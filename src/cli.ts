#!/usr/bin/env node
import { Command } from "commander"
import { FORGE_VERSION } from "./version"
import { newCommand } from "./commands/new"
import { addCommand } from "./commands/add"
import { inspectCommand } from "./commands/inspect"
import { doctorCommand } from "./commands/doctor"
import { generateCommand } from "./commands/generate"
import { skillCommand } from "./commands/skill"
import { stackCommand } from "./commands/stack"

function withFlags(cmd: Command): Command {
  return cmd
    .option("--dry-run", "preview changes without writing")
    .option("-y, --yes", "skip the confirmation prompt (non-interactive)")
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
    .description("scaffold a new project (kind: app | package)")
    .option("--recipe <recipe>", "full-saas | api-web-worker | api-only | worker")
    .option("--scope <scope>", "npm scope for internal packages (default @<name>; @obh for packages)")
    .option("--topology <topology>", "small | split")
    .option("--api-framework <framework>", "hono | express")
    .option("--no-example", "skip the notes example domain (bare health-only app)")
    .option("--no-sdk", "skip the shared SDK package")
    .option("--mobile [name]", "include an Expo mobile app (default name: mobile)")
    .option("--daemon", "for `new package`: also generate an admin/worker daemon")
    .option("--repo <owner/repo>", "GitHub repo for deploy manifests (else auto-detected)"),
).action((kind: string, name: string | undefined, opts: Record<string, unknown>) => newCommand(kind, name, opts))

withFlags(
  program
    .command("add <target> [name]")
    .description("add a primitive (events|jobs|files|audit|settings|api-keys|webhooks|import-export|entitlements|search|analytics|notifications) or app (api|web|worker|sdk|mobile)"),
).action((target: string, name: string | undefined, opts: Record<string, unknown>) => addCommand(target, name, opts))

program.command("inspect").description("report project shape and detected conventions").action(() => inspectCommand())

program.command("doctor").description("check the project against OBH conventions").action(() => doctorCommand())

withFlags(
  program.command("generate <artifact>").description("regenerate an artifact (lwd | ci | env)"),
).action((artifact: string, opts: Record<string, unknown>) => generateCommand(artifact, opts))

withFlags(
  program.command("skill <action> [name]").description("manage OBH Claude skills (list | install <name>)"),
).action((action: string, name: string | undefined, opts: Record<string, unknown>) => skillCommand(action, name, opts))

// Repo → lwd delivery. `forge deploy` is an alias for `forge stack deploy`.
function stackFlags(cmd: Command): Command {
  return withFlags(cmd)
    .option("--rotate <keys>", "regenerate secret(s) (comma-separated) and re-derive connections")
    .option("--app <name>", "limit to one app")
    .option("--no-wait", "don't gate on health between apps")
    .option("--destroy-data", "for rm: attempt to remove named data volumes (lwd preserves them)")
}
function mapStack(opts: Record<string, unknown>): Record<string, unknown> {
  return { ...opts, noWait: opts.wait === false }
}

stackFlags(
  program.command("stack <action>").description("repo → lwd delivery (init | deploy | status | rm)"),
).action((action: string, opts: Record<string, unknown>) => stackCommand(action, mapStack(opts)))

stackFlags(program.command("deploy").description("alias for `forge stack deploy`")).action(
  (opts: Record<string, unknown>) => stackCommand("deploy", mapStack(opts)),
)

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
