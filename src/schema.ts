import { z } from "zod"

/** JSON.parse, retried once with backtick-quoted values turned into JSON strings, a slip models make. */
export function parseLooseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const attempt = (source: string) => {
    try {
      return { ok: true as const, value: JSON.parse(source) as unknown }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  }
  const first = attempt(text)
  if (first.ok) return first
  const repaired = text.replaceAll(/:\s*`([^`]*)`/g, (_, value: string) => `: ${JSON.stringify(value)}`)
  return repaired === text ? first : attempt(repaired)
}

/** Also accepts the value as JSON text: weaker tool-callers often stringify nested arrays and objects. */
function tolerant<T extends z.ZodType>(schema: T) {
  return z.union([
    schema,
    z
      .string()
      .transform((text, ctx) => {
        const parsed = parseLooseJson(text)
        if (parsed.ok) return parsed.value
        ctx.addIssue({ code: "custom", message: `send a list, not text; the text is not valid JSON (${parsed.error})` })
        return z.NEVER
      })
      .pipe(schema),
  ])
}

const DIAGRAM_HEADER =
  /^(sequenceDiagram|flowchart|graph|classDiagram|stateDiagram(-v2)?|erDiagram|gantt|pie|journey|mindmap|timeline|gitGraph)\b/

/** Strips fences and adds `header` when a model sends only the diagram body, as it often does with a line list. */
function mermaidSource(header: string) {
  return (source: string) => {
    const body = source
      .replace(/^\s*```(?:mermaid)?\s*\n?/, "")
      .replace(/\n?\s*```\s*$/, "")
      .trim()
    return DIAGRAM_HEADER.test(body) ? body : `${header}\n${body}`
  }
}

/** A flowchart edge such as `A --> B`, `A -.-> B` or `A ==> B`. */
const EDGE = /-->|---|==>|-\.+->?/
/** A sequence message such as `A->>B: call` or `B-->>A: reply`. */
const MESSAGE = /\S\s*-{1,2}(?:>>|>|x|\))\s*[^:\n]+:/

export const sequenceSource = mermaidSource("sequenceDiagram")
export const overviewSource = mermaidSource("flowchart TD")

/** Lines of text, joined; a list keeps long text off opencode's one-line tool summary. */
const textLines = z.union([z.array(z.string()), z.string()]).transform((value) =>
  Array.isArray(value) ? value.join("\n") : value,
)

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
  diagram: z.string().max(4000).optional().describe("Optional mermaid source illustrating this step. Keep each node label on one short line."),
  needsYou: z
    .string()
    .max(300)
    .optional()
    .describe(
      "Only when this step needs a human decision: one line saying what to decide. Routine steps omit it and are folded away in the review.",
    ),
})
export type StepInput = z.infer<typeof StepInputSchema>

/** A list of points, also accepted as one "a; b; c" string. */
const points = z
  .union([z.array(z.string()), z.string()])
  .transform((value) =>
    Array.isArray(value)
      ? value
      : value
          .split(";")
          .map((point) => point.trim())
          .filter(Boolean),
  )
  .default([])

const CHOSEN_MARK = /\s*\(chosen\)\s*/i

export const AlternativeSchema = z
  .object({
    name: z.string().min(1).max(120),
    pros: points,
    cons: points,
    chosen: z.boolean().optional(),
  })
  .transform(({ name, chosen, ...rest }) => ({
    ...rest,
    name: name.replace(CHOSEN_MARK, " ").trim(),
    chosen: chosen ?? CHOSEN_MARK.test(name),
  }))
export type Alternative = z.infer<typeof AlternativeSchema>

export const PlanInputSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().max(4000).describe("Goal and approach in a few sentences of markdown."),
  steps: z.array(StepInputSchema).min(1).max(40),
  diagram: z.string().max(8000).optional().describe("Optional mermaid source for the whole change (flowchart or sequenceDiagram). Keep each node label on one short line."),
  sequence: z.string().max(8000).optional().describe("Mermaid sequenceDiagram of the runtime interaction the change touches."),
  alternatives: z.array(AlternativeSchema).max(8).optional().describe("Approaches considered; mark the chosen one."),
})
export type PlanInput = z.infer<typeof PlanInputSchema>

/**
 * What plan_propose accepts. Flat arguments, because weaker models mangle nested objects; lists and
 * line arrays for everything long, because opencode prints top-level text arguments in full.
 */
export const ProposeInputSchema = z
  .object({
  title: PlanInputSchema.shape.title,
  summary: textLines
    .pipe(z.string().max(4000))
    .describe("Goal and approach, as a list of short paragraphs (markdown)."),
  steps: tolerant(PlanInputSchema.shape.steps),
  sequence: textLines
    .transform(sequenceSource)
    .pipe(
      z
        .string()
        .max(8000)
        .refine((source) => /^sequenceDiagram\b/.test(source), {
          message: "sequence must be a mermaid sequenceDiagram, not another diagram type",
        })
        .refine((source) => MESSAGE.test(source), {
          message: 'sequence needs mermaid messages between participants, e.g. ["User->>CLI: demo greet", "CLI-->>User: Hello"], not prose',
        }),
    )
    .describe(
      "Required: a mermaid sequenceDiagram, as a list of lines, of the runtime interaction the change touches (participants and the calls between them, before and after where it helps).",
    ),
  overview: textLines
    .transform(overviewSource)
    .pipe(
      z
        .string()
        .max(8000)
        .refine((source) => !/^sequenceDiagram\b/.test(source), {
          message: "overview must be a structural diagram (flowchart); the sequenceDiagram goes in sequence",
        })
        .refine((source) => EDGE.test(source), {
          message: 'overview needs flowchart edges, e.g. ["CLI[bin/demo.ts] --> Stats[src/stats.ts]"], not prose',
        }),
    )
    .describe(
      "Required: a mermaid flowchart, as a list of lines, giving the big picture: the components involved and what the change adds or alters between them. One short line per node label.",
    ),
  alternatives: tolerant(AlternativeSchema.array().max(8)).optional().describe("Approaches considered; mark the chosen one."),
})
  .transform(({ overview, ...plan }) => ({ ...plan, diagram: overview }))
export type ProposeInput = z.infer<typeof ProposeInputSchema>

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
  questions: tolerant(z.array(QuestionSchema).min(1).max(12)),
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
  check: tolerant(CheckSchema).optional().describe("Required with done: how you verified the step."),
})
export type StepUpdate = z.infer<typeof StepUpdateSchema>

export const AmendSchema = z.object({
  reason: z.string().min(1).max(500).describe("What you discovered that the plan did not cover."),
  steps: tolerant(z.array(StepInputSchema).min(1).max(10)).describe("New steps with new ids."),
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
