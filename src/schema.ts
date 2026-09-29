import { z } from "zod"

export const RiskSchema = z.enum(["low", "medium", "high"])
export type Risk = z.infer<typeof RiskSchema>

export const StepStatusSchema = z.enum([
  "proposed",
  "approved",
  "rejected",
  "revise",
  "in_progress",
  "done",
  "blocked",
  "skipped",
])
export type StepStatus = z.infer<typeof StepStatusSchema>

export const StepInputSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,31}$/)
    .describe("Stable step id such as s1. Keep the same id when revising a step so its review carries over."),
  title: z.string().min(1).max(120),
  detail: z.string().max(4000).describe("What changes and how, in markdown."),
  rationale: z.string().max(2000).optional().describe("Why this step is needed or why this approach."),
  files: z
    .array(z.string().min(1))
    .max(50)
    .default([])
    .describe("Workspace-relative paths or globs this step edits. Execution asks before touching anything else."),
  risk: RiskSchema.default("low"),
  dependsOn: z.array(z.string()).optional().describe("Ids of steps that must run first."),
  diagram: z.string().max(4000).optional().describe("Optional mermaid source illustrating this step."),
  needsYou: z
    .string()
    .max(300)
    .optional()
    .describe(
      "Only when this step needs a human decision: one line saying what to decide. Routine steps omit it and are folded away in the review.",
    ),
})
export type StepInput = z.infer<typeof StepInputSchema>

export const AlternativeSchema = z.object({
  name: z.string().min(1).max(120),
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
  chosen: z.boolean().default(false),
})
export type Alternative = z.infer<typeof AlternativeSchema>

export const PlanInputSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().max(4000).describe("Goal and approach in a few sentences of markdown."),
  steps: z.array(StepInputSchema).min(1).max(40),
  diagram: z.string().max(8000).optional().describe("Optional mermaid source for the whole change."),
  alternatives: z.array(AlternativeSchema).max(8).optional().describe("Approaches considered; mark the chosen one."),
})
export type PlanInput = z.infer<typeof PlanInputSchema>

export const CheckSchema = z.object({
  outcome: z.enum(["pass", "fail", "none"]).describe("pass/fail of the check you ran; none when nothing was verifiable."),
  summary: z.string().max(500).describe("One line: what you verified and what it showed."),
  command: z.string().max(300).optional().describe("The command you ran, if any."),
})
export type Check = z.infer<typeof CheckSchema>

export const StepSchema = StepInputSchema.extend({
  status: StepStatusSchema,
  comment: z.string().optional(),
  note: z.string().optional(),
  origin: z.enum(["plan", "amendment"]).default("plan"),
  touched: z.array(z.string()).default([]),
  check: CheckSchema.optional(),
})
export type Step = z.infer<typeof StepSchema>

export const PlanStateSchema = z.enum(["review", "executing", "done"])
export type PlanState = z.infer<typeof PlanStateSchema>

export const ReviewReasonSchema = z.enum(["plan", "amendment", "checkpoint"])
export type ReviewReason = z.infer<typeof ReviewReasonSchema>

export const PlanSchema = PlanInputSchema.extend({
  sessionID: z.string(),
  version: z.number().int().positive(),
  state: PlanStateSchema,
  reviewReason: ReviewReasonSchema.default("plan"),
  steps: z.array(StepSchema).min(1),
  outside: z.array(z.string()).default([]),
  createdAt: z.number(),
})
export type Plan = z.infer<typeof PlanSchema>

export const VerdictSchema = z.enum(["approve", "reject", "revise"])
export type Verdict = z.infer<typeof VerdictSchema>

export const DecisionSchema = z.object({
  stepID: z.string(),
  verdict: VerdictSchema.optional(),
  comment: z.string().max(4000).optional(),
  edit: z
    .object({
      title: z.string().min(1).max(120).optional(),
      detail: z.string().max(4000).optional(),
    })
    .optional(),
})
export type Decision = z.infer<typeof DecisionSchema>

export const ReviewActionSchema = z.enum(["revise", "execute"])
export type ReviewAction = z.infer<typeof ReviewActionSchema>

export const ReviewSchema = z.object({
  sessionID: z.string(),
  version: z.number().int().positive(),
  decisions: z.array(DecisionSchema),
  note: z.string().max(4000).optional(),
  action: ReviewActionSchema,
})
export type Review = z.infer<typeof ReviewSchema>

export const QuestionKindSchema = z.enum(["text", "single", "multi", "confirm"])
export type QuestionKind = z.infer<typeof QuestionKindSchema>

export const QuestionSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
  question: z.string().min(1).max(500),
  kind: QuestionKindSchema,
  options: z
    .array(
      z.object({
        value: z.string().min(1),
        label: z.string().min(1).max(120),
        description: z.string().max(300).optional(),
      }),
    )
    .max(12)
    .optional()
    .describe("Required for single and multi."),
  recommended: z.array(z.string()).optional().describe("Option values you recommend; shown pre-selected."),
})
export type Question = z.infer<typeof QuestionSchema>

export const QuestionsInputSchema = z.object({
  questions: z.array(QuestionSchema).min(1).max(12),
})
export type QuestionsInput = z.infer<typeof QuestionsInputSchema>

export const QuestionsSchema = QuestionsInputSchema.extend({
  id: z.string(),
  sessionID: z.string(),
})
export type Questions = z.infer<typeof QuestionsSchema>

export const AnswersSchema = z.object({
  sessionID: z.string(),
  id: z.string(),
  answers: z.record(z.string(), z.array(z.string())),
})
export type Answers = z.infer<typeof AnswersSchema>

export const StepUpdateSchema = z.object({
  stepID: z.string(),
  status: z.enum(["in_progress", "done", "blocked", "skipped"]),
  note: z.string().max(1000).optional(),
  check: CheckSchema.optional().describe("Required with done: how you verified the step."),
})
export type StepUpdate = z.infer<typeof StepUpdateSchema>

export const AmendSchema = z.object({
  reason: z.string().min(1).max(500).describe("What you discovered that the plan did not cover."),
  steps: z.array(StepInputSchema).min(1).max(10).describe("New steps with new ids."),
})
export type Amend = z.infer<typeof AmendSchema>

export const CheckpointSchema = z.enum(["off", "risky", "every"])
export type Checkpoint = z.infer<typeof CheckpointSchema>

export const OptionsSchema = z.object({
  agent: z.string().default("architect"),
  buildAgent: z.string().default("build"),
  gate: z.enum(["ask", "deny", "off"]).default("ask"),
  checkpoint: CheckpointSchema.default("risky"),
  autoPlan: z.boolean().default(true),
})
export type Options = z.infer<typeof OptionsSchema>
