import type { Decision, Plan, Question, Questions, Review, Step, Verdict } from "../schema.ts"

export interface StepDraft {
  verdict?: Verdict
  comment?: string
  edit?: { title?: string; detail?: string }
}

export interface PlanDraft {
  version: number
  steps: Record<string, StepDraft>
  note?: string
}

export interface AnswerDraft {
  id: string
  answers: Record<string, string[]>
}

const VERDICT_STATUS: Record<Verdict, Step["status"]> = { approve: "approved", reject: "rejected", revise: "revise" }

export const isFinished = (step: Step) => step.status === "done" || step.status === "skipped"

/** Status shown in the panel: the pending draft verdict wins over the stored one, except on finished steps. */
export function effectiveStatus(step: Step, draft: StepDraft | undefined): Step["status"] {
  if (isFinished(step)) return step.status
  if (draft?.verdict) return VERDICT_STATUS[draft.verdict]
  if (draft?.edit) return "approved"
  return step.status
}

export const freshDraft = (plan: Plan): PlanDraft => ({ version: plan.version, steps: {} })

export function toReview(plan: Plan, draft: PlanDraft, action: Review["action"]): Review {
  const decisions = Object.entries(draft.steps).map(([stepID, step]): Decision => ({ stepID, ...step }))
  return { sessionID: plan.sessionID, version: plan.version, decisions, note: draft.note, action }
}

export function initialAnswers(questions: Questions): AnswerDraft {
  const answers = Object.fromEntries(
    questions.questions.map((question): [string, string[]] => [question.id, question.recommended ?? []]),
  )
  return { id: questions.id, answers }
}

export function toggle(question: Question, current: readonly string[], value: string): string[] {
  if (question.kind === "multi") return current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
  return [value]
}

export const CONFIRM_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const

export const optionsOf = (question: Question) =>
  question.kind === "confirm" ? CONFIRM_OPTIONS : (question.options ?? [])
