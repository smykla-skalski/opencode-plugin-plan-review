import type { Rpc } from "@opencode/plugin"
import { z } from "zod"
import { AnswersSchema, PlanSchema, QuestionsSchema, ReviewSchema } from "./schema.ts"

const OutcomeSchema = z.object({ ok: z.boolean(), error: z.string().optional() })

export const ChangeReasonSchema = z.enum(["proposed", "reviewed", "step", "questions", "answered"])
export type ChangeReason = z.infer<typeof ChangeReasonSchema>

/** Shared by the server and TUI entries; the TUI reaches it through client.rpc(PlanRpc). */
export const PlanRpc = {
  id: "planreview",
  methods: {
    get: {
      input: z.object({ sessionID: z.string() }),
      output: z.object({ plan: PlanSchema.nullable(), questions: QuestionsSchema.nullable() }),
    },
    review: { input: ReviewSchema, output: OutcomeSchema },
    answer: { input: AnswersSchema, output: OutcomeSchema },
  },
  events: {
    changed: {
      schema: z.object({ sessionID: z.string(), reason: ChangeReasonSchema, version: z.number().optional() }),
    },
  },
} as const satisfies Rpc.PortableDefinition
