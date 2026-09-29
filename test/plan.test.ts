import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { amend, approvedSteps, attention, drift, propose, recordTouch, review, updateStep } from "../src/plan.ts"
import { PlanInputSchema, type Plan, type PlanInput, type StepInput } from "../src/schema.ts"

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

const executing = (decisions = ["s1", "s2"]): Plan => {
  const result = review(first(), {
    sessionID: "ses_1",
    version: 1,
    action: "execute",
    decisions: decisions.map((stepID) => ({ stepID, verdict: "approve" as const })),
  })
  assert.ok(result.ok)
  return result.value
}

const pass = { outcome: "pass" as const, summary: "tests green" }

describe("updateStep", () => {
  it("refuses steps that were not approved", () => {
    assert.equal(updateStep(executing(), { stepID: "s3", status: "in_progress" }).ok, false)
  })

  it("requires a check to mark a step done", () => {
    assert.equal(updateStep(executing(), { stepID: "s1", status: "done" }).ok, false)
  })

  it("finishes the plan once every approved step is settled", () => {
    const one = updateStep(executing(), { stepID: "s1", status: "done", check: pass })
    assert.ok(one.ok)
    assert.equal(one.value.state, "executing")
    assert.deepEqual(one.value.steps[0]!.check, pass)
    const two = updateStep(one.value, { stepID: "s2", status: "skipped", note: "already there" })
    assert.ok(two.ok)
    assert.equal(two.value.state, "done")
  })
})

describe("checkpoints", () => {
  const cases: [string, "off" | "risky" | "every", string, "pass" | "fail", boolean][] = [
    ["risky mode pauses after a high-risk step", "risky", "s3", "pass", true],
    ["risky mode pauses after a failed check", "risky", "s1", "fail", true],
    ["risky mode runs on after a routine pass", "risky", "s1", "pass", false],
    ["every mode pauses after any step", "every", "s1", "pass", true],
    ["off never pauses", "off", "s3", "fail", false],
  ]
  for (const [name, mode, stepID, outcome, paused] of cases)
    it(name, () => {
      const result = updateStep(
        executing(["s1", "s2", "s3"]),
        { stepID, status: "done", check: { outcome, summary: "x" } },
        mode,
      )
      assert.ok(result.ok)
      assert.equal(result.value.state, paused ? "review" : "executing")
      if (paused) assert.equal(result.value.reviewReason, "checkpoint")
    })

  it("continues after the user approves the checkpoint", () => {
    const paused = updateStep(executing(["s1", "s2", "s3"]), { stepID: "s3", status: "done", check: pass }, "risky")
    assert.ok(paused.ok)
    const resumed = review(paused.value, { sessionID: "ses_1", version: 1, action: "execute", decisions: [] })
    assert.ok(resumed.ok)
    assert.equal(resumed.value.state, "executing")
    assert.equal(resumed.value.steps[2]!.status, "done")
  })

  it("does not pause after the last step; the plan is done", () => {
    const result = updateStep(executing(["s3"]), { stepID: "s3", status: "done", check: pass }, "every")
    assert.ok(result.ok)
    assert.equal(result.value.state, "done")
  })
})

describe("amend", () => {
  const extra = (overrides: Partial<StepInput> = {}): StepInput => ({
    id: "s9",
    title: "Extra",
    detail: "found during work",
    files: ["src/config.ts"],
    risk: "low",
    ...overrides,
  })

  it("approves a routine step inside approved files and keeps running", () => {
    const result = amend(executing(), { reason: "missed", steps: [extra()] }, "/repo")
    assert.ok(result.ok)
    assert.equal(result.value.paused, false)
    const added = result.value.plan.steps.at(-1)!
    assert.equal(added.status, "approved")
    assert.equal(added.origin, "amendment")
    assert.equal(added.rationale, "missed")
  })

  const pausing: [string, Partial<StepInput>][] = [
    ["new files", { files: ["src/other.ts"] }],
    ["high risk", { risk: "high" }],
    ["a decision", { needsYou: "pick a cache" }],
    ["no files", { files: [] }],
  ]
  for (const [name, overrides] of pausing)
    it(`pauses for review on ${name}`, () => {
      const result = amend(executing(), { reason: "r", steps: [extra(overrides)] }, "/repo")
      assert.ok(result.ok)
      assert.equal(result.value.paused, true)
      assert.equal(result.value.plan.state, "review")
      assert.equal(result.value.plan.reviewReason, "amendment")
      assert.equal(result.value.plan.version, 2)
    })

  it("rejects reused ids and amending a plan that is not executing", () => {
    assert.equal(amend(executing(), { reason: "r", steps: [extra({ id: "s1" })] }, "/repo").ok, false)
    assert.equal(amend(first(), { reason: "r", steps: [extra()] }, "/repo").ok, false)
  })
})

describe("recordTouch", () => {
  it("attributes edits to the step in progress and flags drift", () => {
    const started = updateStep(executing(), { stepID: "s1", status: "in_progress" })
    assert.ok(started.ok)
    const touched = recordTouch(started.value, ["/repo/src/config.ts", "/repo/src/extra.ts"], "/repo")
    const step = touched.steps[0]!
    assert.deepEqual(step.touched, ["src/config.ts", "src/extra.ts"])
    assert.deepEqual(drift(step, "/repo"), ["src/extra.ts"])
  })

  it("keeps edits with no step in progress on the plan", () => {
    const touched = recordTouch(executing(), ["/repo/x.ts"], "/repo")
    assert.deepEqual(touched.outside, ["x.ts"])
  })
})

describe("propose after execution", () => {
  it("keeps finished steps finished when the agent leaves them unchanged", () => {
    const done = updateStep(executing(), { stepID: "s1", status: "done", check: pass })
    assert.ok(done.ok)
    const next = propose(done.value, input(), "ses_1", 2)
    assert.ok(next.ok)
    assert.equal(next.value.steps[0]!.status, "done")
    assert.deepEqual(next.value.steps[0]!.check, pass)
  })
})

describe("attention", () => {
  it("folds routine steps and surfaces the ones needing a person", () => {
    const plan = first()
    assert.deepEqual(
      plan.steps.map((step) => attention(step)),
      [false, false, true],
    )
    assert.equal(attention({ ...plan.steps[0]!, needsYou: "decide" }), true)
  })
})
