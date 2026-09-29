import { PlanSchema, QuestionsSchema, type Plan, type Questions } from "./schema.ts"

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export interface KV {
  readonly get: (key: string) => Promise<unknown>
  readonly set: (key: string, value: Json) => Promise<void>
  readonly remove: (key: string) => Promise<void>
}

const planKey = (sessionID: string) => `plan/${sessionID}`
const historyKey = (sessionID: string, version: number) => `plan/${sessionID}/v${version}`
const questionsKey = (sessionID: string) => `questions/${sessionID}`

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Json

/**
 * Plugin storage survives restarts, so a pending review is never lost with the process.
 * opencode runs a turn's tool calls concurrently, so every read-modify-write of a session's
 * plan goes through `exclusive` or a stale copy can overwrite a newer state.
 */
export function createStore(kv: KV) {
  const queues = new Map<string, Promise<unknown>>()
  const exclusive = <A>(sessionID: string, run: () => Promise<A>): Promise<A> => {
    const next = (queues.get(sessionID) ?? Promise.resolve()).then(run, run)
    const tail = next.then(
      () => null,
      () => null,
    )
    queues.set(sessionID, tail)
    void tail.then(() => {
      if (queues.get(sessionID) === tail) queues.delete(sessionID)
      return null
    })
    return next
  }
  return {
    exclusive,
    async plan(sessionID: string) {
      const parsed = PlanSchema.safeParse(await kv.get(planKey(sessionID)))
      return parsed.success ? parsed.data : undefined
    },
    async savePlan(plan: Plan) {
      await kv.set(planKey(plan.sessionID), json(plan))
      await kv.set(historyKey(plan.sessionID, plan.version), json(plan))
    },
    async questions(sessionID: string) {
      const parsed = QuestionsSchema.safeParse(await kv.get(questionsKey(sessionID)))
      return parsed.success ? parsed.data : undefined
    },
    async saveQuestions(questions: Questions) {
      await kv.set(questionsKey(questions.sessionID), json(questions))
    },
    async clearQuestions(sessionID: string) {
      await kv.remove(questionsKey(sessionID))
    },
  }
}

export type Store = ReturnType<typeof createStore>
