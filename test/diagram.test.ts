import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { normalizeMermaid, pan, renderDiagram } from "../src/diagram.ts"

describe("pan", () => {
  const art = "┌──────────┐\n│ abcdefgh │\n└──────────┘"

  it("shows the whole diagram when it fits", () => {
    const view = pan(art, 0, 40)
    assert.deepEqual(view.lines, art.split("\n"))
    assert.equal(view.left, false)
    assert.equal(view.right, false)
  })

  it("slices a window and says there is more to the right", () => {
    const view = pan(art, 0, 5)
    assert.deepEqual(view.lines, ["┌────", "│ abc", "└────"])
    assert.equal(view.right, true)
    assert.equal(view.left, false)
  })

  it("clamps the offset so the last column stays reachable", () => {
    const view = pan(art, 99, 5)
    assert.equal(view.offset, 7)
    assert.deepEqual(view.lines, ["────┐", "fgh │", "────┘"])
    assert.equal(view.left, true)
    assert.equal(view.right, false)
  })
})

describe("normalizeMermaid", () => {
  it("joins a node label the model wrapped across lines", () => {
    assert.equal(
      normalizeMermaid("flowchart TD\n  A[s1: pin versions\nkuma3-preflight] --> B[s2]"),
      "flowchart TD\n  A[s1: pin versions kuma3-preflight] --> B[s2]",
    )
  })

  it("leaves well-formed diagrams alone", () => {
    const source = "flowchart LR\n  A --> B\n  B --> C{ok?}"
    assert.equal(normalizeMermaid(source), source)
  })
})

describe("renderDiagram", () => {
  it("draws a flowchart as boxes with every label", () => {
    const art = renderDiagram("flowchart TD\n  A[pin versions] --> B[report format]\n  B --> C{green?}")
    assert.ok(art)
    for (const label of ["pin versions", "report format", "green?"]) assert.ok(art.includes(label), label)
    assert.match(art, /[┌└│]/)
  })

  it("draws a wrapped label as one box", () => {
    const art = renderDiagram("flowchart TD\n  A[s1: pin versions\nkuma3-preflight] --> B[s2]")
    assert.ok(art?.includes("s1: pin versions kuma3-preflight"))
  })

  it("draws sequence diagrams", () => {
    assert.ok(renderDiagram("sequenceDiagram\n  A->>B: hi\n  B-->>A: ok")?.includes("hi"))
  })

  it("returns null for something it cannot draw", () => {
    assert.equal(renderDiagram("this is not mermaid"), null)
  })
})
