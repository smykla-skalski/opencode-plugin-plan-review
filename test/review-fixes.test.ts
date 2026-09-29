import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { amend, editedFiles, propose, recordTouch, review, updateStep } from "../src/plan.ts"
import { reviewMessage } from "../src/render.ts"
import { PlanInputSchema, type Plan, type StepInput } from "../src/schema.ts"
import { createStore, type KV } from "../src/store.ts"

const plan = (files: string[][], risks: StepInput["risk"][] = []): Plan => {
  const input = PlanInputSchema.parse({
    title: "T",
    summary: "S",
    steps: files.map((stepFiles, index) => ({
      id: `s${index + 1}`,
      title: `Step ${index + 1}`,
      detail: "d",
      files: stepFiles,
      risk: risks[index] ?? "low",
    })),
  })
  const proposed = propose(undefined, input, "ses_1", 1)
  assert.ok(proposed.ok)
  const executing = review(proposed.value, {
    sessionID: "ses_1",
    version: 1,
    action: "execute",
    decisions: proposed.value.steps.map((step) => ({ stepID: step.id, verdict: "approve" as const })),
  })
  assert.ok(executing.ok)
  return executing.value
}

const step = (files: string[]): StepInput => ({ id: "s9", title: "Extra", detail: "d", files, risk: "low" })

describe("amend globs", () => {
  const cases: [string, string[], string[], boolean][] = [
    ["** after *", ["*"], ["**"], true],
    ["src/** after src/*", ["src/*"], ["src/**"], true],
    ["src/*.ts after src/?.ts", ["src/?.ts"], ["src/*.ts"], true],
    ["an identical glob", ["src/*.ts"], ["src/*.ts"], false],
    ["a literal file under an approved glob", ["src/*.ts"], ["src/a.ts"], false],
    ["a literal file under an approved directory", ["src/"], ["src/deep/a.ts"], false],
  ]
  for (const [name, approved, amended, paused] of cases)
    it(`${paused ? "pauses" : "runs on"} for ${name}`, () => {
      const result = amend(plan([approved]), { reason: "r", steps: [step(amended)] }, "/repo")
      assert.ok(result.ok)
      assert.equal(result.value.paused, paused)
    })
})

describe("troubled last step", () => {
  it("pauses at a checkpoint when the last step is blocked", () => {
    const result = updateStep(plan([["a.ts"]]), { stepID: "s1", status: "blocked", note: "stuck" }, "risky")
    assert.ok(result.ok)
    assert.equal(result.value.state, "review")
    assert.equal(result.value.reviewReason, "checkpoint")
  })

  it("pauses when the last step finishes with a failing check, and can resume it", () => {
    const paused = updateStep(
      plan([["a.ts"]]),
      { stepID: "s1", status: "done", check: { outcome: "fail", summary: "red" } },
      "risky",
    )
    assert.ok(paused.ok)
    assert.equal(paused.value.state, "review")
    const resumed = review(paused.value, { sessionID: "ses_1", version: 1, action: "execute", decisions: [] })
    assert.ok(resumed.ok)
    assert.equal(resumed.value.state, "executing")
    assert.ok(updateStep(resumed.value, { stepID: "s1", status: "in_progress" }).ok)
  })

  it("still finishes when checkpoints are off", () => {
    const result = updateStep(plan([["a.ts"]]), { stepID: "s1", status: "blocked" }, "off")
    assert.ok(result.ok)
    assert.equal(result.value.state, "done")
  })
})

describe("re-planning", () => {
  it("does not carry unattributed edits from a finished plan into the next one", () => {
    const touched = recordTouch(plan([["a.ts"]]), ["/repo/x.ts"], "/repo")
    const done = updateStep(touched, { stepID: "s1", status: "done", check: { outcome: "pass", summary: "ok" } })
    assert.ok(done.ok)
    assert.equal(done.value.state, "done")
    const next = propose(done.value, PlanInputSchema.parse({ title: "U", summary: "S", steps: [step(["b.ts"])] }), "ses_1", 2)
    assert.ok(next.ok)
    assert.deepEqual(next.value.outside, [])
  })

  it("keeps touched files of an unchanged in-progress step when re-proposed", () => {
    const started = updateStep(plan([["a.ts"]]), { stepID: "s1", status: "in_progress" })
    assert.ok(started.ok)
    const touched = recordTouch(started.value, ["/repo/a.ts"], "/repo")
    const input = PlanInputSchema.parse({ title: "T", summary: "S", steps: [{ id: "s1", title: "Step 1", detail: "d", files: ["a.ts"] }] })
    const next = propose(touched, input, "ses_1", 2)
    assert.ok(next.ok)
    assert.equal(next.value.steps[0]!.status, "proposed")
    assert.deepEqual(next.value.steps[0]!.touched, ["a.ts"])
  })

  it("tells the agent to re-propose, not amend, after a checkpoint revise", () => {
    const paused = updateStep(plan([["a.ts"], ["b.ts"]], ["high"]), { stepID: "s1", status: "done", check: { outcome: "pass", summary: "ok" } }, "risky")
    assert.ok(paused.ok)
    const text = reviewMessage(paused.value, { sessionID: "ses_1", version: 1, action: "revise", decisions: [] }).text
    assert.match(text, /plan_propose/)
    assert.doesNotMatch(text, /plan_amend/)
  })
})

describe("editedFiles", () => {
  const cases: [string, unknown, string[]][] = [
    ["write output", { operation: "write", resource: "src/a.ts", target: "/repo/src/a.ts", existed: true }, ["src/a.ts"]],
    ["edit output", { files: [{ file: "src/b.ts" }], replacements: 1 }, ["src/b.ts"]],
    ["patch output", { applied: [{ type: "add", resource: "c.ts" }], files: [{ file: "c.ts" }, { file: "d.ts" }] }, ["c.ts", "d.ts"]],
    ["no output", undefined, []],
  ]
  for (const [name, output, expected] of cases) it(name, () => assert.deepEqual(editedFiles(output), expected))
})

describe("store.exclusive", () => {
  const slowKV = (): KV => {
    const data = new Map<string, unknown>()
    const pause = () =>
      new Promise((resolve) => {
        setTimeout(resolve, Math.random() * 5)
      })
    return {
      async get(key) {
        await pause()
        return data.get(key)
      },
      async set(key, value) {
        await pause()
        data.set(key, value)
      },
      async remove(key) {
        data.delete(key)
      },
    }
  }

  it("serializes concurrent read-modify-writes so no update is lost", async () => {
    const store = createStore(slowKV())
    await store.savePlan(plan([["a.ts"]]))
    const started = updateStep((await store.plan("ses_1"))!, { stepID: "s1", status: "in_progress" })
    assert.ok(started.ok)
    await store.savePlan(started.value)
    const files = Array.from({ length: 20 }, (_, index) => `/repo/f${index}.ts`)
    await Promise.all(
      files.map((file) =>
        store.exclusive("ses_1", async () => {
          const current = (await store.plan("ses_1"))!
          await store.savePlan(recordTouch(current, [file], "/repo"))
        }),
      ),
    )
    assert.equal((await store.plan("ses_1"))!.steps[0]!.touched.length, 20)
  })

  it("keeps running after a failed critical section", async () => {
    const store = createStore(slowKV())
    await assert.rejects(
      store.exclusive("ses_1", async () => {
        throw new Error("boom")
      }),
    )
    assert.equal(await store.exclusive("ses_1", async () => 42), 42)
  })
})
