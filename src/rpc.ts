import type { Rpc } from "@opencode/plugin"
import { z } from "zod"
import { AnswersSchema, PlanSchema, QuestionsSchema, ReviewSchema } from "./schema.ts"

const OutcomeSchema = z.object({ ok: z.boolean(), error: z.string().optional() })

export const ChangeReasonSchema = z.enum(["proposed", "reviewed", "step", "questions", "answered", "amended", "checkpoint", "done", "touch"])
export type ChangeReason = z.infer<typeof ChangeReasonSchema>

export const HistoryEntrySchema = z.object({
  id: z.number().int().positive(),
  at: z.number(),
  reason: z.enum(["proposed", "reviewed", "amended", "step", "checkpoint", "done", "touch"]),
  version: z.number().int().positive(),
  plan: PlanSchema,
  review: ReviewSchema.optional(),
})
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>

/** Shared by the server and TUI entries; the TUI reaches it through client.rpc(PlanRpc). */
export const PlanRpc = {
  id: "planreview",
  methods: {
    get: {
      input: z.object({ sessionID: z.string() }),
      output: z.object({ plan: PlanSchema.nullable(), questions: QuestionsSchema.nullable() }),
    },
    history: {
      input: z.object({ sessionID: z.string() }),
      output: z.object({ events: z.array(HistoryEntrySchema) }),
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
