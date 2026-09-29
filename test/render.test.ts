import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { propose, review } from "../src/plan.ts"
import { answersMessage, buildReminder, planMarkdown, reviewMessage } from "../src/render.ts"
import { PlanInputSchema, type Review } from "../src/schema.ts"

const plan = () => {
  const result = propose(
    undefined,
    PlanInputSchema.parse({
      title: "T",
      summary: "S",
      diagram: "flowchart LR\n A-->B",
      alternatives: [{ name: "SDK", pros: ["less code"], cons: ["dep"], chosen: true }],
      steps: [
        { id: "s1", title: "One", detail: "d1", files: ["a.ts"] },
        { id: "s2", title: "Two", detail: "d2" },
      ],
    }),
    "ses_1",
    1,
  )
  assert.ok(result.ok)
  return result.value
}

describe("render", () => {
  it("renders mermaid, alternatives and every step in the markdown fallback", () => {
    const text = planMarkdown(plan())
    assert.match(text, /```mermaid\nflowchart LR/)
    assert.match(text, /\| SDK \| less code \| dep \| ✓ \|/)
    assert.match(text, /s1\. One/)
    assert.match(text, /s2\. Two/)
  })

  it("carries comments and the action into the review message", () => {
    const input: Review = {
      sessionID: "ses_1",
      version: 1,
      action: "revise",
      note: "keep it small",
      decisions: [{ stepID: "s2", verdict: "revise", comment: "split it" }],
    }
    const reviewed = review(plan(), input)
    assert.ok(reviewed.ok)
    const message = reviewMessage(reviewed.value, input)
    assert.match(message.text, /action="revise"/)
    assert.match(message.text, /> split it/)
    assert.match(message.text, /> keep it small/)
    assert.match(message.description, /→ revise$/)
  })

  it("tells the build agent what not to implement", () => {
    const reviewed = review(plan(), {
      sessionID: "ses_1",
      version: 1,
      action: "execute",
      decisions: [
        { stepID: "s1", verdict: "approve" },
        { stepID: "s2", verdict: "reject" },
      ],
    })
    assert.ok(reviewed.ok)
    const reminder = buildReminder(reviewed.value)
    assert.match(reminder, /- s1 \[approved\] One \(files: a\.ts\)/)
    assert.match(reminder, /Do NOT implement: s2 Two/)
  })

  it("maps answer values to option labels", () => {
    const message = answersMessage(
      {
        id: "q1",
        sessionID: "ses_1",
        questions: [
          { id: "db", question: "Which DB?", kind: "single", options: [{ value: "pg", label: "Postgres" }] },
          { id: "why", question: "Why?", kind: "text" },
        ],
      },
      { sessionID: "ses_1", id: "q1", answers: { db: ["pg"] } },
    )
    assert.match(message.text, /→ Postgres/)
    assert.match(message.text, /→ \(no answer\)/)
  })
})
