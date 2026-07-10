import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import type { CapabilityName } from "./types"
import { CAPABILITIES } from "./capabilities"

// Every implemented platform primitive must ship a retrofit skill that teaches an
// agent to assess and (on request) apply the move onto that primitive. This map is
// the contract; adding a primitive to CAPABILITIES without a skill fails the test.
const PRIMITIVE_SKILL: Record<CapabilityName, string> = {
  events: "obh-add-events",
  jobs: "obh-retrofit-jobs",
  files: "obh-retrofit-files",
  audit: "obh-generate-audit-rules",
  settings: "obh-settings-migration",
  "api-keys": "obh-retrofit-api-keys",
  webhooks: "obh-retrofit-webhooks",
  "import-export": "obh-retrofit-import-export",
  entitlements: "obh-retrofit-entitlements",
  search: "obh-retrofit-search",
  analytics: "obh-retrofit-analytics",
  notifications: "obh-retrofit-notifications",
}

const skillsRoot = path.join(__dirname, "..", "skills")

function frontmatter(name: string): { name?: string; description?: string } {
  const raw = readFileSync(path.join(skillsRoot, name, "SKILL.md"), "utf8")
  return {
    name: raw.match(/^name:\s*(.+)$/m)?.[1]?.trim(),
    description: raw.match(/^description:\s*(.+)$/m)?.[1]?.trim(),
  }
}

describe("retrofit skill coverage", () => {
  const implemented = Object.keys(CAPABILITIES) as CapabilityName[]

  it("maps every implemented primitive to a skill", () => {
    for (const cap of implemented) {
      expect(PRIMITIVE_SKILL[cap], `no retrofit skill mapped for "${cap}"`).toBeTruthy()
    }
  })

  it.each(implemented)("%s ships a well-formed SKILL.md", (cap) => {
    const dir = PRIMITIVE_SKILL[cap]
    expect(existsSync(path.join(skillsRoot, dir, "SKILL.md")), `${dir}/SKILL.md missing`).toBe(true)
    const fm = frontmatter(dir)
    expect(fm.name, `${dir} frontmatter name must equal its directory`).toBe(dir)
    expect((fm.description ?? "").length, `${dir} needs a non-empty description`).toBeGreaterThan(0)
  })
})
