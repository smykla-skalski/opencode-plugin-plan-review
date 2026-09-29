import type { Decision, Plan, PlanInput, Review, Step, StepUpdate } from "./schema.ts"

export type Result<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly error: string }

const ok = <A>(value: A): Result<A> => ({ ok: true, value })
const fail = <A>(error: string): Result<A> => ({ ok: false, error })

const unchanged = (a: Step, b: PlanInput["steps"][number]) =>
  a.title === b.title && a.detail === b.detail && a.files.join("\n") === b.files.join("\n")

/** Builds the next plan version; approved steps the agent left untouched stay approved. */
export function propose(previous: Plan | undefined, input: PlanInput, sessionID: string, now: number): Result<Plan> {
  const ids = new Set<string>()
  for (const step of input.steps) {
    if (ids.has(step.id)) return fail(`Duplicate step id "${step.id}". Step ids must be unique.`)
    ids.add(step.id)
  }
  const missing = input.steps.flatMap((step) => (step.dependsOn ?? []).filter((id) => !ids.has(id)))
  if (missing.length) return fail(`dependsOn references unknown step ids: ${missing.join(", ")}`)

  const before = new Map(previous?.steps.map((step) => [step.id, step]))
  const steps = input.steps.map((step): Step => {
    const prior = before.get(step.id)
    const kept = prior?.status === "approved" && unchanged(prior, step)
    return { ...step, status: kept ? "approved" : "proposed" }
  })
  return ok({
    ...input,
    steps,
    sessionID,
    version: (previous?.version ?? 0) + 1,
    state: "review",
    createdAt: now,
  })
}

const statusFor = (decision: Decision): Step["status"] | undefined => {
  if (decision.verdict === "approve") return "approved"
  if (decision.verdict === "reject") return "rejected"
  if (decision.verdict === "revise") return "revise"
  if (decision.edit) return "approved"
  return undefined
}

/** Applies a user review. Edited steps count as approved in their edited form. */
export function review(plan: Plan, input: Review): Result<Plan> {
  if (plan.state !== "review") return fail(`Plan v${plan.version} is ${plan.state}, not awaiting review.`)
  if (input.version !== plan.version) return fail(`Review is for v${input.version} but the plan is at v${plan.version}.`)
  const known = new Set(plan.steps.map((step) => step.id))
  const unknown = input.decisions.filter((decision) => !known.has(decision.stepID)).map((d) => d.stepID)
  if (unknown.length) return fail(`Unknown step ids in review: ${unknown.join(", ")}`)

  const decisions = new Map(input.decisions.map((decision) => [decision.stepID, decision]))
  const steps = plan.steps.map((step): Step => {
    const decision = decisions.get(step.id)
    if (!decision) return step
    return {
      ...step,
      ...decision.edit,
      status: statusFor(decision) ?? step.status,
      comment: decision.comment ?? step.comment,
    }
  })

  if (input.action === "revise") return ok({ ...plan, steps })
  const approved = steps.filter((step) => step.status === "approved")
  if (!approved.length) return fail("Nothing to execute: approve at least one step.")
  return ok({ ...plan, steps, state: "executing" })
}

export function updateStep(plan: Plan, update: StepUpdate): Result<Plan> {
  if (plan.state !== "executing") return fail(`Plan v${plan.version} is not executing.`)
  const target = plan.steps.find((step) => step.id === update.stepID)
  if (!target) return fail(`Unknown step "${update.stepID}".`)
  if (target.status === "rejected" || target.status === "revise" || target.status === "proposed")
    return fail(`Step "${update.stepID}" was not approved; do not work on it.`)
  const steps = plan.steps.map((step) =>
    step.id === update.stepID ? { ...step, status: update.status, note: update.note ?? step.note } : step,
  )
  const finished = steps.every((step) => step.status !== "approved" && step.status !== "in_progress")
  return ok({ ...plan, steps, state: finished ? "done" : "executing" })
}

export const approvedSteps = (plan: Plan) =>
  plan.steps.filter((step) => ["approved", "in_progress", "done", "blocked"].includes(step.status))

export function tally(plan: Plan) {
  const counts: Record<Step["status"], number> = {
    proposed: 0,
    approved: 0,
    rejected: 0,
    revise: 0,
    in_progress: 0,
    done: 0,
    blocked: 0,
    skipped: 0,
  }
  for (const step of plan.steps) counts[step.status] += 1
  return counts
}
