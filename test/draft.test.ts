import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { propose } from "../src/plan.ts"
import { PlanInputSchema, type Question } from "../src/schema.ts"
import { effectiveStatus, formRows, initialAnswers, jumpQuestion, pinned, toReview, toggle } from "../src/tui/draft.ts"

const single: Question = { id: "a", question: "?", kind: "single", options: [{ value: "x", label: "X" }] }
const multi: Question = { ...single, kind: "multi" }

describe("draft", () => {
  it("lets a pending verdict or edit override the stored status", () => {
    const step = {
      id: "s1",
      title: "t",
      detail: "d",
      files: [],
      risk: "low" as const,
      status: "proposed" as const,
      origin: "plan" as const,
      touched: [],
    }
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

describe("pinned", () => {
  const plan = (state: "review" | "executing" | "done") => {
    const result = propose(
      undefined,
      PlanInputSchema.parse({ title: "T", summary: "S", steps: [{ id: "s1", title: "t", detail: "d" }] }),
      "ses_1",
      1,
    )
    assert.ok(result.ok)
    return { ...result.value, state }
  }
  const questions = { id: "q1", sessionID: "ses_1", questions: [single] }

  it("keeps the panel open from the first question until the plan runs", () => {
    assert.equal(pinned(undefined), false)
    assert.equal(pinned({ plan: null, questions: null }), false)
    assert.equal(pinned({ plan: null, questions }), true)
    assert.equal(pinned({ plan: plan("review"), questions: null }), true)
    assert.equal(pinned({ plan: plan("executing"), questions: null }), false)
    assert.equal(pinned({ plan: plan("done"), questions: null }), false)
    assert.equal(pinned({ plan: plan("executing"), questions }), true)
  })
})

describe("questions form rows", () => {
  const questions = {
    id: "q1",
    sessionID: "s",
    questions: [
      {
        ...single,
        id: "a",
        options: [
          { value: "x", label: "X" },
          { value: "y", label: "Y" },
        ],
      },
      { id: "b", question: "why?", kind: "text" as const },
      { ...multi, id: "c" },
    ],
  }
  const rows = formRows(questions)

  it("lays every option, text answer and the send button on one cursor path", () => {
    assert.deepEqual(
      rows.map((row) => (row.kind === "send" ? "send" : `${row.kind}:${row.question}`)),
      ["option:0", "option:0", "text:1", "option:2", "send"],
    )
  })

  it("jumps to the next question's first stop and ends on send", () => {
    assert.equal(jumpQuestion(rows, 0, 1), 2)
    assert.equal(jumpQuestion(rows, 1, 1), 2)
    assert.equal(jumpQuestion(rows, 3, 1), 4)
    assert.equal(jumpQuestion(rows, 4, 1), 4)
  })

  it("jumps back to the previous question's first stop", () => {
    assert.equal(jumpQuestion(rows, 3, -1), 2)
    assert.equal(jumpQuestion(rows, 2, -1), 0)
    assert.equal(jumpQuestion(rows, 4, -1), 3)
    assert.equal(jumpQuestion(rows, 0, -1), 0)
  })
})
