import { describe, expect, it } from "vitest"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Plan } from "./plan"

function tmpRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), "forge-test-"))
}

const noDry = { dryRun: false, force: false }

describe("Plan file ops", () => {
  it("creates a file, then leaves it untouched on identical re-run", async () => {
    const root = tmpRoot()
    await new Plan().create("a.txt", "hello", "a").apply(root, noDry)
    expect(readFileSync(path.join(root, "a.txt"), "utf8")).toBe("hello")

    // Same content again → skipped, no error.
    await new Plan().create("a.txt", "hello", "a").apply(root, noDry)
    expect(readFileSync(path.join(root, "a.txt"), "utf8")).toBe("hello")
  })

  it("refuses to clobber a differing file without force", async () => {
    const root = tmpRoot()
    writeFileSync(path.join(root, "a.txt"), "mine")
    const wrote = await new Plan().create("a.txt", "generated", "a").apply(root, noDry)
    expect(wrote).toBe(false)
    expect(readFileSync(path.join(root, "a.txt"), "utf8")).toBe("mine")
  })

  it("overwrites a differing file with force", async () => {
    const root = tmpRoot()
    writeFileSync(path.join(root, "a.txt"), "mine")
    await new Plan().overwrite("a.txt", "generated", "a").apply(root, { dryRun: false, force: true })
    expect(readFileSync(path.join(root, "a.txt"), "utf8")).toBe("generated")
  })

  it("appends a marked section idempotently", async () => {
    const root = tmpRoot()
    const plan1 = new Plan().append("b.txt", "// MARK", "body-line", "b")
    await plan1.apply(root, noDry)
    const after1 = readFileSync(path.join(root, "b.txt"), "utf8")
    expect(after1).toContain("// MARK")
    expect(after1).toContain("body-line")

    // Re-running the same marker does not duplicate.
    await new Plan().append("b.txt", "// MARK", "body-line", "b").apply(root, noDry)
    const after2 = readFileSync(path.join(root, "b.txt"), "utf8")
    expect(after2.match(/MARK/g)?.length).toBe(1)
  })

  it("merges a dependency into an existing package.json", async () => {
    const root = tmpRoot()
    await new Plan()
      .create("package.json", JSON.stringify({ name: "x" }, null, 2) + "\n", "pkg")
      .addDependency(".", "pg", "^8.12.0")
      .apply(root, noDry)
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
    expect(pkg.dependencies.pg).toBe("^8.12.0")
  })

  it("documents env vars without duplicating", async () => {
    const root = tmpRoot()
    await new Plan().addEnvVar({ name: "FOO", example: "bar" }).apply(root, noDry)
    await new Plan().addEnvVar({ name: "FOO", example: "bar" }).apply(root, noDry)
    const env = readFileSync(path.join(root, ".env.example"), "utf8")
    expect(env.match(/^FOO=/gm)?.length).toBe(1)
  })

  it("does not write during a dry run", async () => {
    const root = tmpRoot()
    const wrote = await new Plan().create("a.txt", "hello", "a").apply(root, { dryRun: true, force: false })
    expect(wrote).toBe(false)
  })
})
