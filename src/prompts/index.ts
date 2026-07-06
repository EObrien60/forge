import prompts from "prompts"
import type { CapabilityName, RecipeName, Topology } from "../types"
import { isImplemented } from "../capabilities"

export interface NewAnswers {
  name: string
  scope: string
  recipe: RecipeName
  topology: Topology
  primitives: CapabilityName[]
}

const IMPLEMENTED_PRIMITIVES: CapabilityName[] = ["events", "jobs", "files", "audit"]

function onCancel(): never {
  console.log("Cancelled.")
  process.exit(1)
}

/** Interactive questions for `forge new app`. Only asks where shape truly varies. */
export async function askNew(defaults: Partial<NewAnswers>): Promise<NewAnswers> {
  const res = await prompts(
    [
      {
        type: defaults.name ? null : "text",
        name: "name",
        message: "Project name",
        validate: (v: string) => (/^[a-z][a-z0-9-]*$/.test(v) ? true : "lowercase letters, digits, dashes"),
      },
      {
        type: "select",
        name: "recipe",
        message: "Recipe",
        choices: [
          { title: "full-saas — api + admin + worker + sdk + core primitives", value: "full-saas" },
          { title: "api-web-worker — api + admin + worker + sdk", value: "api-web-worker" },
          { title: "api-only — backend + sdk", value: "api-only" },
          { title: "worker — background worker only", value: "worker" },
        ],
        initial: 0,
      },
      {
        type: "select",
        name: "topology",
        message: "Deployment topology",
        choices: [
          { title: "small — API co-locates Postgres (simplest)", value: "small" },
          { title: "split — separate api / worker / db apps (scales)", value: "split" },
        ],
        initial: 0,
      },
      {
        type: "multiselect",
        name: "primitives",
        message: "Extra platform primitives (space to toggle)",
        choices: IMPLEMENTED_PRIMITIVES.map((p) => ({ title: p, value: p })),
        hint: "- all opt-in",
      },
    ],
    { onCancel },
  )

  const name = defaults.name ?? res.name
  return {
    name,
    scope: defaults.scope ?? `@${name}`,
    recipe: res.recipe as RecipeName,
    topology: res.topology as Topology,
    primitives: (res.primitives as CapabilityName[]).filter(isImplemented),
  }
}

/** Confirm applying a plan when not running with --yes. */
export async function confirmApply(): Promise<boolean> {
  const res = await prompts({ type: "confirm", name: "ok", message: "Apply these changes?", initial: true }, { onCancel })
  return res.ok === true
}

/** Yes/no prompt (e.g. adding a missing prerequisite). */
export async function confirm(message: string): Promise<boolean> {
  const res = await prompts({ type: "confirm", name: "ok", message, initial: true }, { onCancel })
  return res.ok === true
}
