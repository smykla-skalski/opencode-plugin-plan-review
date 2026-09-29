import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { propose } from "../src/plan.ts"
import { PlanInputSchema, type Question } from "../src/schema.ts"
import { effectiveStatus, initialAnswers, toReview, toggle } from "../src/tui/draft.ts"

const single: Question = { id: "a", question: "?", kind: "single", options: [{ value: "x", label: "X" }] }
const multi: Question = { ...single, kind: "multi" }

describe("draft", () => {
  it("lets a pending verdict or edit override the stored status", () => {
    const step = { id: "s1", title: "t", detail: "d", files: [], risk: "low" as const, status: "proposed" as const }
    assert.equal(effectiveStatus(step, undefined), "proposed")
    assert.equal(effectiveStatus(step, { verdict: "reject" }), "rejected")
    assert.equal(effectiveStatus(step, { edit: { detail: "x" } }), "approved")
  })

  it("replaces single answers and toggles multi answers", () => {
    assert.deepEqual(toggle(single, ["y"], "x"), ["x"])
    assert.deepEqual(toggle(multi, ["y"], "x"), ["y", "x"])
    assert.deepEqual(toggle(multi, ["y", "x"], "x"), ["y"])
  })

  it("preselects recommended options", () => {
    const draft = initialAnswers({
      id: "q1",
      sessionID: "s",
      questions: [{ ...single, recommended: ["x"] }, { ...multi, id: "b" }],
    })
    assert.deepEqual(draft.answers, { a: ["x"], b: [] })
  })

  it("turns a draft into a review for the current version", () => {
    const result = propose(
      undefined,
      PlanInputSchema.parse({ title: "T", summary: "S", steps: [{ id: "s1", title: "t", detail: "d" }] }),
      "ses_1",
      1,
    )
    assert.ok(result.ok)
    const review = toReview(result.value, { version: 1, steps: { s1: { verdict: "approve" } }, note: "ok" }, "execute")
    assert.deepEqual(review, {
      sessionID: "ses_1",
      version: 1,
      action: "execute",
      note: "ok",
      decisions: [{ stepID: "s1", verdict: "approve" }],
    })
  })
})
