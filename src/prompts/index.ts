import prompts from "prompts"
import type { ApiFramework, CapabilityName, ExampleDomain, RecipeName, Topology } from "../types"
import { CAPABILITIES, isImplemented } from "../capabilities"

export interface NewAnswers {
  name: string
  scope: string
  recipe: RecipeName
  topology: Topology
  apiFramework: ApiFramework
  example: ExampleDomain
  sdk: boolean
  /** Mobile app directory name, or null for none. */
  mobile: string | null
  primitives: CapabilityName[]
}

function onCancel(): never {
  console.log("Cancelled.")
  process.exit(1)
}

const primitiveChoices = () =>
  (Object.keys(CAPABILITIES) as CapabilityName[]).map((p) => ({ title: `${p} — ${CAPABILITIES[p]?.describe ?? ""}`, value: p }))

/** Interactive questions for `forge new app`. Only asks where shape truly varies. */
export async function askNew(defaults: Partial<NewAnswers> & { sdk?: boolean }): Promise<NewAnswers> {
  const res = await prompts(
    [
      {
        type: defaults.name ? null : "text",
        name: "name",
        message: "Project name",
        validate: (v: string) => (/^[a-z][a-z0-9-]*$/.test(v) ? true : "lowercase letters, digits, dashes"),
      },
      {
        type: defaults.recipe ? null : "select",
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
        type: defaults.apiFramework ? null : "select",
        name: "apiFramework",
        message: "API framework",
        choices: [
          { title: "hono — light, modern (recommended for greenfield)", value: "hono" },
          { title: "express — familiar, best for retrofits", value: "express" },
        ],
        initial: 0,
      },
      {
        type: defaults.example !== undefined ? null : "confirm",
        name: "exampleOn",
        message: "Include a real example domain (notes: CRUD wired end-to-end)?",
        initial: true,
      },
      {
        type: defaults.mobile !== undefined ? null : "confirm",
        name: "mobileOn",
        message: "Include a mobile app (Expo)?",
        initial: false,
      },
      {
        type: defaults.topology ? null : "select",
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
        message: "Platform primitives to install now (space to toggle, prerequisites auto-added)",
        choices: primitiveChoices(),
        hint: "- all opt-in",
      },
    ],
    { onCancel },
  )

  const name = defaults.name ?? res.name
  return {
    name,
    scope: defaults.scope ?? `@${name}`,
    recipe: (defaults.recipe ?? res.recipe) as RecipeName,
    topology: (defaults.topology ?? res.topology) as Topology,
    apiFramework: (defaults.apiFramework ?? res.apiFramework) as ApiFramework,
    example: defaults.example !== undefined ? defaults.example : res.exampleOn ? "notes" : null,
    sdk: defaults.sdk ?? true,
    mobile: defaults.mobile !== undefined ? defaults.mobile : res.mobileOn ? "mobile" : null,
    primitives: ((res.primitives as CapabilityName[]) ?? []).filter(isImplemented),
  }
}

/** Ask for a GitHub owner/repo when git detection fails. Empty string = skip. */
export async function askRepo(suggested: string): Promise<string> {
  const res = await prompts(
    {
      type: "text",
      name: "repo",
      message: "GitHub owner/repo for deploy manifests (blank to fill in later)",
      initial: suggested,
    },
    { onCancel },
  )
  return (res.repo as string | undefined)?.trim() ?? ""
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
