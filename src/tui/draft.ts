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

/** One cursor stop in the questions form: an option, a text answer, or the send button. */
export type FormRow =
  | { readonly kind: "option"; readonly question: number; readonly option: number }
  | { readonly kind: "text"; readonly question: number }
  | { readonly kind: "send" }

export function formRows(questions: Questions): FormRow[] {
  const rows = questions.questions.flatMap((question, index): FormRow[] =>
    question.kind === "text"
      ? [{ kind: "text", question: index }]
      : optionsOf(question).map((_, option) => ({ kind: "option", question: index, option })),
  )
  return [...rows, { kind: "send" }]
}

const questionOf = (row: FormRow | undefined) => (row && row.kind !== "send" ? row.question : undefined)

/** Row index of the first stop of the next (or previous) question; the send row ends the form. */
export function jumpQuestion(rows: readonly FormRow[], index: number, delta: 1 | -1): number {
  const current = questionOf(rows[index])
  if (delta === 1) {
    const next = rows.findIndex((row, at) => at > index && questionOf(row) !== current)
    return next === -1 ? rows.length - 1 : next
  }
  const target = current === undefined ? questionOf(rows.at(-2)) : current - 1
  if (target === undefined || target < 0) return 0
  return rows.findIndex((row) => questionOf(row) === target)
}
