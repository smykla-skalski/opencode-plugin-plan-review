import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { approvedSteps, propose, review, updateStep } from "../src/plan.ts"
import { PlanInputSchema, type Plan, type PlanInput } from "../src/schema.ts"

const input = (overrides: Partial<PlanInput> = {}) =>
  PlanInputSchema.parse({
    title: "Add OAuth login",
    summary: "Log in with the company IdP.",
    steps: [
      { id: "s1", title: "Config schema", detail: "Add oauth block", files: ["src/config.ts"] },
      { id: "s2", title: "Callback route", detail: "Handle /callback", files: ["src/auth/"], dependsOn: ["s1"] },
      { id: "s3", title: "Migrate sessions", detail: "New column", files: ["db/**/*.sql"], risk: "high" },
    ],
    ...overrides,
  })

const first = (): Plan => {
  const result = propose(undefined, input(), "ses_1", 1)
  assert.ok(result.ok)
  return result.value
}

describe("propose", () => {
  it("starts at v1 with every step proposed", () => {
    const plan = first()
    assert.equal(plan.version, 1)
    assert.equal(plan.state, "review")
    assert.deepEqual(
      plan.steps.map((step) => step.status),
      ["proposed", "proposed", "proposed"],
    )
  })

  it("rejects duplicate ids and unknown dependencies", () => {
    const dup = input({ steps: [...input().steps, { ...input().steps[0]!, title: "again" }] })
    assert.equal(propose(undefined, dup, "ses_1", 1).ok, false)
    const dangling = input({ steps: [{ ...input().steps[0]!, dependsOn: ["s9"] }] })
    assert.equal(propose(undefined, dangling, "ses_1", 1).ok, false)
  })

  it("keeps approval only for steps the agent left unchanged", () => {
    const reviewed = review(first(), {
      sessionID: "ses_1",
      version: 1,
      action: "revise",
      decisions: [
        { stepID: "s1", verdict: "approve" },
        { stepID: "s2", verdict: "approve" },
        { stepID: "s3", verdict: "reject", comment: "no migration" },
      ],
    })
    assert.ok(reviewed.ok)
    const steps = input().steps
    const next = propose(
      reviewed.value,
      input({ steps: [steps[0]!, { ...steps[1]!, detail: "Handle /oauth/callback" }] }),
      "ses_1",
      2,
    )
    assert.ok(next.ok)
    assert.equal(next.value.version, 2)
    assert.deepEqual(
      next.value.steps.map((step) => step.status),
      ["approved", "proposed"],
    )
  })
})

describe("review", () => {
  it("refuses a stale version", () => {
    const result = review(first(), { sessionID: "ses_1", version: 2, action: "revise", decisions: [] })
    assert.equal(result.ok, false)
  })

  it("treats an edit as approval and records comments", () => {
    const result = review(first(), {
      sessionID: "ses_1",
      version: 1,
      action: "revise",
      decisions: [{ stepID: "s2", edit: { detail: "Use the SDK" }, comment: "simpler" }],
    })
    assert.ok(result.ok)
    const step = result.value.steps[1]!
    assert.equal(step.status, "approved")
    assert.equal(step.detail, "Use the SDK")
    assert.equal(step.comment, "simpler")
  })

  it("executes only when something is approved", () => {
    const none = review(first(), { sessionID: "ses_1", version: 1, action: "execute", decisions: [] })
    assert.equal(none.ok, false)
    const some = review(first(), {
      sessionID: "ses_1",
      version: 1,
      action: "execute",
      decisions: [{ stepID: "s1", verdict: "approve" }],
    })
    assert.ok(some.ok)
    assert.equal(some.value.state, "executing")
    assert.deepEqual(
      approvedSteps(some.value).map((step) => step.id),
      ["s1"],
    )
  })
})

describe("updateStep", () => {
  const executing = () => {
    const result = review(first(), {
      sessionID: "ses_1",
      version: 1,
      action: "execute",
      decisions: [
        { stepID: "s1", verdict: "approve" },
        { stepID: "s2", verdict: "approve" },
      ],
    })
    assert.ok(result.ok)
    return result.value
  }

  it("refuses steps that were not approved", () => {
    assert.equal(updateStep(executing(), { stepID: "s3", status: "in_progress" }).ok, false)
  })

  it("finishes the plan once every approved step is settled", () => {
    const one = updateStep(executing(), { stepID: "s1", status: "done" })
    assert.ok(one.ok)
    assert.equal(one.value.state, "executing")
    const two = updateStep(one.value, { stepID: "s2", status: "skipped", note: "already there" })
    assert.ok(two.ok)
    assert.equal(two.value.state, "done")
  })
})
