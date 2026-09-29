import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { covered } from "../src/gate.ts"

const dir = "/repo"

describe("covered", () => {
  const cases: [string, string, readonly string[], boolean][] = [
    ["exact relative file", "src/config.ts", ["src/config.ts"], true],
    ["absolute resource", "/repo/src/config.ts", ["src/config.ts"], true],
    ["file under listed directory", "src/auth/cb.ts", ["src/auth/"], true],
    ["directory without trailing slash", "src/auth/cb.ts", ["src/auth"], true],
    ["sibling with shared prefix", "src/authz.ts", ["src/auth"], false],
    ["single-star glob", "src/a.ts", ["src/*.ts"], true],
    ["single star stays in one directory", "src/x/a.ts", ["src/*.ts"], false],
    ["double-star glob", "db/m/001/up.sql", ["db/**/*.sql"], true],
    ["unlisted file", "README.md", ["src/config.ts"], false],
    ["outside the workspace", "/etc/passwd", ["**"], false],
    ["nothing approved", "src/config.ts", [], false],
  ]
  for (const [name, resource, files, expected] of cases)
    it(name, () => assert.equal(covered(resource, files, dir), expected))
})
