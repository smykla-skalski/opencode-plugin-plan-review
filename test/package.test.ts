import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"

const root = path.join(import.meta.dirname, "..")

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name.startsWith(".") ? [] : tsxFiles(full)
    return entry.name.endsWith(".tsx") ? [full] : []
  })
}

describe("published TUI files", () => {
  const files = tsxFiles(root)

  it("finds the TUI entry files", () => {
    assert.ok(files.length >= 4)
  })

  for (const file of files)
    it(`${path.relative(root, file)} declares the opentui JSX runtime`, () => {
      assert.match(readFileSync(file, "utf8"), /^\/\*\* @jsxImportSource @opentui\/solid \*\//)
    })
})
