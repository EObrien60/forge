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

  it("expands multi-prerequisite capabilities before the dependent", () => {
    // import-export requires files AND jobs
    const order = resolveOrder(["import-export"])
    expect(order[order.length - 1]).toBe("import-export")
    expect(order).toContain("files")
    expect(order).toContain("jobs")
    expect(order.indexOf("files")).toBeLessThan(order.indexOf("import-export"))
    expect(order.indexOf("jobs")).toBeLessThan(order.indexOf("import-export"))
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
  it("knows the shipped capabilities", () => {
    expect(isImplemented("events")).toBe(true)
    expect(isImplemented("jobs")).toBe(true)
    expect(isImplemented("search")).toBe(true)
    expect(isImplemented("notifications")).toBe(true)
    // A name that is not a real capability.
    expect(isImplemented("nope" as never)).toBe(false)
  })
})
