import { describe, expect, it } from "vitest"
import { resolveOrder, missingPrerequisites, isImplemented } from "./index"

describe("resolveOrder", () => {
  it("puts prerequisites before dependents", () => {
    // audit requires events
    expect(resolveOrder(["audit"])).toEqual(["events", "audit"])
  })

  it("does not duplicate when a prerequisite is already requested", () => {
    expect(resolveOrder(["events", "audit"])).toEqual(["events", "audit"])
  })

  it("preserves independent capabilities in order", () => {
    expect(resolveOrder(["jobs", "files"])).toEqual(["jobs", "files"])
  })
})

describe("missingPrerequisites", () => {
  it("reports an uninstalled prerequisite", () => {
    expect(missingPrerequisites("audit", () => false)).toEqual(["events"])
  })

  it("reports nothing when the prerequisite is installed", () => {
    expect(missingPrerequisites("audit", (n) => n === "events")).toEqual([])
  })
})

describe("isImplemented", () => {
  it("knows the v1 capabilities", () => {
    expect(isImplemented("events")).toBe(true)
    expect(isImplemented("jobs")).toBe(true)
    expect(isImplemented("search")).toBe(false)
  })
})
