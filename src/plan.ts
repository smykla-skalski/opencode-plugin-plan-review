import { covered } from "./gate.ts"
import type { Amend, Checkpoint, Decision, Plan, PlanInput, Review, Step, StepInput, StepUpdate } from "./schema.ts"

export type Result<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly error: string }

const ok = <A>(value: A): Result<A> => ({ ok: true, value })
const fail = <A>(error: string): Result<A> => ({ ok: false, error })

const SETTLED: ReadonlySet<Step["status"]> = new Set(["approved", "done", "skipped"])
const FINISHED: ReadonlySet<Step["status"]> = new Set(["done", "skipped"])
const WORKING: ReadonlySet<Step["status"]> = new Set(["approved", "in_progress", "done", "blocked", "skipped"])
const RISK_ORDER: Record<Step["risk"], number> = { high: 0, medium: 1, low: 2 }

const unchanged = (a: Step, b: StepInput) =>
  a.title === b.title && a.detail === b.detail && a.files.join("\n") === b.files.join("\n")

const fresh = (step: StepInput, status: Step["status"], origin: Step["origin"]): Step => ({
  ...step,
  status,
  origin,
  touched: [],
})

function duplicate(steps: readonly StepInput[], taken: ReadonlySet<string> = new Set()) {
  const ids = new Set(taken)
  for (const step of steps) {
    if (ids.has(step.id)) return step.id
    ids.add(step.id)
  }
  return null
}

function danglingDependencies(steps: readonly StepInput[], known: ReadonlySet<string>) {
  return steps.flatMap((step) => (step.dependsOn ?? []).filter((id) => !known.has(id)))
}

/** Builds the next plan version; settled steps the agent left untouched keep their status and results. */
export function propose(previous: Plan | undefined, input: PlanInput, sessionID: string, now: number): Result<Plan> {
  const dup = duplicate(input.steps)
  if (dup) return fail(`Duplicate step id "${dup}". Step ids must be unique.`)
  const missing = danglingDependencies(input.steps, new Set(input.steps.map((step) => step.id)))
  if (missing.length) return fail(`dependsOn references unknown step ids: ${missing.join(", ")}`)

  const before = new Map(previous?.steps.map((step) => [step.id, step]))
  const steps = input.steps.map((step): Step => {
    const prior = before.get(step.id)
    if (!prior || !unchanged(prior, step)) return fresh(step, "proposed", "plan")
    const status = SETTLED.has(prior.status) ? prior.status : "proposed"
    return { ...step, status, origin: prior.origin, touched: prior.touched, check: prior.check }
  })
  return ok({
    ...input,
    steps,
    sessionID,
    version: (previous?.version ?? 0) + 1,
    state: "review",
    reviewReason: "plan",
    outside: previous && previous.state !== "done" ? previous.outside : [],
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

/** Applies a user review. Edited steps count as approved; finished steps only take comments. */
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
    const comment = decision.comment ?? step.comment
    if (FINISHED.has(step.status)) return { ...step, comment }
    return { ...step, ...decision.edit, status: statusFor(decision) ?? step.status, comment }
  })

  if (input.action === "revise") return ok({ ...plan, steps })
  if (!steps.some((step) => unfinished(step))) return fail("Nothing to execute: approve at least one step that is not finished.")
  return ok({ ...plan, steps, state: "executing" })
}

export interface Amended {
  readonly plan: Plan
  readonly paused: boolean
}

/**
 * Adds steps found during execution. A routine step inside the files already approved runs on;
 * anything risky, flagged for a decision, or reaching new files pauses the plan for review.
 */
export function amend(plan: Plan, input: Amend, directory: string): Result<Amended> {
  if (plan.state !== "executing") return fail(`Plan v${plan.version} is not executing; use plan_propose instead.`)
  const dup = duplicate(input.steps, new Set(plan.steps.map((step) => step.id)))
  if (dup) return fail(`Step id "${dup}" is already used. Amended steps need new ids.`)
  const known = new Set([...plan.steps, ...input.steps].map((step) => step.id))
  const missing = danglingDependencies(input.steps, known)
  if (missing.length) return fail(`dependsOn references unknown step ids: ${missing.join(", ")}`)

  const allowed = approvedFiles(plan)
  const within = (file: string) => (isGlob(file) ? allowed.includes(file) : covered(file, allowed, directory))
  const routine = (step: StepInput) =>
    !step.needsYou && step.risk !== "high" && step.files.length > 0 && step.files.every((file) => within(file))
  const added = input.steps.map((step) => ({
    ...fresh(step, routine(step) ? "approved" : "proposed", "amendment"),
    rationale: step.rationale ?? input.reason,
  }))
  const steps = [...plan.steps, ...added]
  const paused = added.some((step) => step.status === "proposed")
  if (!paused) return ok({ plan: { ...plan, steps }, paused })
  return ok({
    plan: { ...plan, steps, version: plan.version + 1, state: "review", reviewReason: "amendment" },
    paused,
  })
}

const needsCheckpoint = (step: Step, mode: Checkpoint) => {
  if (mode === "off") return false
  if (mode === "every") return true
  return step.risk === "high" || step.status === "blocked" || step.check?.outcome === "fail"
}

/** Records progress; a finished risky or failing step pauses at a checkpoint when work remains. */
export function updateStep(plan: Plan, update: StepUpdate, mode: Checkpoint = "off"): Result<Plan> {
  if (plan.state !== "executing") return fail(`Plan v${plan.version} is not executing.`)
  const target = plan.steps.find((step) => step.id === update.stepID)
  if (!target) return fail(`Unknown step "${update.stepID}".`)
  if (!WORKING.has(target.status)) return fail(`Step "${update.stepID}" was not approved; do not work on it.`)
  if (update.status === "done" && !update.check)
    return fail(`Mark "${update.stepID}" done with check: how you verified it (outcome pass, fail or none).`)

  const next: Step = { ...target, status: update.status, note: update.note ?? target.note, check: update.check ?? target.check }
  const steps = plan.steps.map((step) => (step.id === update.stepID ? next : step))
  const remaining = steps.some((step) => step.status === "approved" || step.status === "in_progress")
  const settled = update.status === "done" || update.status === "blocked"
  const pause = settled && needsCheckpoint(next, mode)
  if (remaining) return ok(pause ? { ...plan, steps, state: "review", reviewReason: "checkpoint" } : { ...plan, steps })
  if (mode !== "off" && steps.some((step) => troubled(step)))
    return ok({ ...plan, steps, state: "review", reviewReason: "checkpoint" })
  return ok({ ...plan, steps, state: "done" })
}

/** Attributes edited files to the steps in progress, or to the plan when no step claims them. */
export function recordTouch(plan: Plan, resources: readonly string[], directory: string): Plan {
  const files = resources.map((resource) => relativeTo(resource, directory))
  const active = plan.steps.filter((step) => step.status === "in_progress")
  if (!active.length) return { ...plan, outside: merge(plan.outside, files) }
  return {
    ...plan,
    steps: plan.steps.map((step) =>
      step.status === "in_progress" ? { ...step, touched: merge(step.touched, files) } : step,
    ),
  }
}

/** Touched files the step did not list: drift between plan and reality. */
export const drift = (step: Step, directory: string) =>
  step.touched.filter((file) => !covered(file, step.files, directory))

const merge = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])]

const isGlob = (file: string) => file.includes("*") || file.includes("?")

/** A step that stopped short: blocked, or finished with a failing check. */
export const troubled = (step: Step) =>
  step.status === "blocked" || (step.status === "done" && step.check?.outcome === "fail")

const unfinished = (step: Step) =>
  step.status === "approved" || step.status === "in_progress" || troubled(step)

type Fields = Readonly<Record<string, unknown>>
const isRecord = (value: unknown): value is Fields => typeof value === "object" && value !== null
const strings = (value: unknown, key: string) =>
  Array.isArray(value)
    ? value.flatMap((item) => (isRecord(item) && typeof item[key] === "string" ? [item[key] as string] : []))
    : []

/** Files a successful edit, write or patch changed, read from the tool's structured output. */
export function editedFiles(output: unknown): string[] {
  if (!isRecord(output)) return []
  const single = typeof output.resource === "string" ? [output.resource] : []
  return [...new Set([...single, ...strings(output.files, "file"), ...strings(output.applied, "resource")])]
}

function relativeTo(resource: string, directory: string) {
  if (!resource.startsWith("/")) return resource
  return resource.startsWith(`${directory}/`) ? resource.slice(directory.length + 1) : resource
}

export const approvedSteps = (plan: Plan) =>
  plan.steps.filter((step) => ["approved", "in_progress", "done", "blocked"].includes(step.status))

export const approvedFiles = (plan: Plan) => approvedSteps(plan).flatMap((step) => step.files)

export const byRisk = (steps: readonly Step[]) =>
  [...steps].sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk])

/** Steps shown by default: the ones asking for a decision, plus anything the user already touched or that went wrong. */
export const attention = (step: Step) =>
  Boolean(step.needsYou) ||
  step.risk === "high" ||
  step.status === "blocked" ||
  step.status === "revise" ||
  step.check?.outcome === "fail" ||
  step.origin === "amendment"

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
