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

describe("tool inputs", () => {
  const step = { id: "s1", title: "One", detail: "d" }
  const sequence = ["sequenceDiagram", "  User->>CLI: run", "  CLI-->>User: done"]

  it("accepts flat arguments with summary and diagram as lists of lines", async () => {
    const { ProposeInputSchema } = await import("../src/schema.ts")
    const parsed = ProposeInputSchema.parse({
      title: "T",
      summary: ["first", "second"],
      sequence,
      diagram: ["flowchart TD", "  A --> B"],
      steps: [step],
    })
    assert.equal(parsed.summary, "first\nsecond")
    assert.equal(parsed.diagram, "flowchart TD\n  A --> B")
    assert.equal(parsed.steps[0]?.risk, "low")
    assert.equal(parsed.sequence, sequence.join("\n"))
  })

  it("requires a sequence diagram on every plan", async () => {
    const { ProposeInputSchema } = await import("../src/schema.ts")
    const base = { title: "T", summary: "S", steps: [step] }
    assert.equal(ProposeInputSchema.safeParse(base).success, false)
    assert.equal(ProposeInputSchema.safeParse({ ...base, sequence: ["flowchart TD", "  A --> B"] }).success, false)
    assert.equal(ProposeInputSchema.safeParse({ ...base, sequence }).success, true)
  })

  it("adds the sequenceDiagram header models leave out and strips fences", async () => {
    const { ProposeInputSchema } = await import("../src/schema.ts")
    const base = { title: "T", summary: "S", steps: [step] }
    const headerless = ProposeInputSchema.parse({ ...base, sequence: ["participant U as User", "U->>CLI: run"] })
    assert.equal(headerless.sequence, "sequenceDiagram\nparticipant U as User\nU->>CLI: run")
    const fenced = ProposeInputSchema.parse({ ...base, sequence: "```mermaid\nsequenceDiagram\n  A->>B: hi\n```" })
    assert.equal(fenced.sequence, "sequenceDiagram\n  A->>B: hi")
  })

  it("accepts alternatives with pros and cons as text and (chosen) in the name", async () => {
    const { ProposeInputSchema } = await import("../src/schema.ts")
    const parsed = ProposeInputSchema.parse({
      title: "T",
      summary: "S",
      sequence,
      steps: [step],
      alternatives: [
        { name: "Explicit parameter (chosen)", pros: "No hidden state; testable", cons: "Extra parameter" },
        { name: "Env var", pros: ["Zero changes"], cons: [] },
      ],
    })
    assert.deepEqual(parsed.alternatives?.[0], {
      name: "Explicit parameter",
      pros: ["No hidden state", "testable"],
      cons: ["Extra parameter"],
      chosen: true,
    })
    assert.equal(parsed.alternatives?.[1]?.chosen, false)
  })

  it("accepts steps, alternatives, questions and checks sent as JSON text", async () => {
    const { AmendSchema, ProposeInputSchema, QuestionsInputSchema, StepUpdateSchema } = await import("../src/schema.ts")
    const plan = ProposeInputSchema.parse({
      title: "T",
      summary: "plain text summary",
      sequence: sequence.join("\n"),
      steps: JSON.stringify([step]),
      alternatives: JSON.stringify([{ name: "A", chosen: true }]),
    })
    assert.equal(plan.steps[0]?.id, "s1")
    assert.equal(plan.alternatives?.[0]?.chosen, true)
    const questions = QuestionsInputSchema.parse({
      questions: JSON.stringify([{ id: "q", question: "?", kind: "text" }]),
    })
    assert.equal(questions.questions[0]?.id, "q")
    const update = StepUpdateSchema.parse({
      stepID: "s1",
      status: "done",
      check: JSON.stringify({ outcome: "pass", summary: "ok" }),
    })
    assert.equal(update.check?.outcome, "pass")
    assert.equal(AmendSchema.parse({ reason: "r", steps: JSON.stringify([step]) }).steps.length, 1)
  })

  it("still rejects text that is not structured data", async () => {
    const { ProposeInputSchema } = await import("../src/schema.ts")
    const result = ProposeInputSchema.safeParse({
      title: "T",
      summary: "S",
      sequence,
      steps: "title</arg_key><arg_value>not json",
    })
    assert.equal(result.success, false)
  })
})
