import { PlanSchema, QuestionsSchema, type Plan, type Questions } from "./schema.ts"
import { HistoryEntrySchema, type HistoryEntry } from "./rpc.ts"
import type { Review } from "./schema.ts"

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export interface KV {
  readonly get: (key: string) => Promise<unknown>
  readonly set: (key: string, value: Json) => Promise<void>
  readonly remove: (key: string) => Promise<void>
}

const planKey = (sessionID: string) => `plan/${sessionID}`
const historyKey = (sessionID: string, version: number) => `plan/${sessionID}/v${version}`
const questionsKey = (sessionID: string) => `questions/${sessionID}`
const countKey = (sessionID: string) => `history/${sessionID}/count`
const eventKey = (sessionID: string, id: number) => `history/${sessionID}/${id}`

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Json

/**
 * Plugin storage survives restarts, so a pending review is never lost with the process.
 * opencode runs a turn's tool calls concurrently, so every read-modify-write of a session's
 * plan goes through `exclusive` or a stale copy can overwrite a newer state.
 */
export function createStore(kv: KV) {
  const count = async (sessionID: string) => {
    const stored = await kv.get(countKey(sessionID))
    if (stored != null && (!Number.isSafeInteger(stored) || (stored as number) < 0))
      throw new Error("Invalid plan history count")
    let latest = (stored as number | null | undefined) ?? 0
    if (latest) {
      const current = HistoryEntrySchema.parse(await kv.get(eventKey(sessionID, latest)))
      if (current.id !== latest) throw new Error("Invalid plan history order")
    }
    while (true) {
      const pending = await kv.get(eventKey(sessionID, latest + 1))
      if (pending == null) break
      const parsed = HistoryEntrySchema.parse(pending)
      if (parsed.id !== latest + 1) throw new Error("Invalid plan history order")
      latest += 1
    }
    if (latest !== ((stored as number | null | undefined) ?? 0))
      await kv.set(countKey(sessionID), latest)
    return latest
  }
  const readEntry = async (sessionID: string, id: number) =>
    HistoryEntrySchema.parse(await kv.get(eventKey(sessionID, id)))
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
      const latest = await count(sessionID)
      if (latest) return (await readEntry(sessionID, latest)).plan
      const parsed = PlanSchema.safeParse(await kv.get(planKey(sessionID)))
      return parsed.success ? parsed.data : undefined
    },
    async savePlan(plan: Plan) {
      await kv.set(planKey(plan.sessionID), json(plan))
      if ((await kv.get(historyKey(plan.sessionID, plan.version))) == null)
        await kv.set(historyKey(plan.sessionID, plan.version), json(plan))
    },
    async history(sessionID: string): Promise<HistoryEntry[]> {
      const latest = await count(sessionID)
      return Promise.all(Array.from({ length: latest }, (_, index) => readEntry(sessionID, index + 1)))
    },
    async appendHistory(
      plan: Plan,
      reason: HistoryEntry["reason"],
      review?: Review,
    ): Promise<HistoryEntry> {
      const latest = await count(plan.sessionID)
      const entry: HistoryEntry = {
        id: latest + 1,
        at: Date.now(),
        reason,
        version: plan.version,
        plan,
        ...(review ? { review } : {}),
      }
      await kv.set(eventKey(plan.sessionID, entry.id), json(entry))
      await kv.set(countKey(plan.sessionID), entry.id)
      return entry
    },
    async saveWithHistory(plan: Plan, reason: HistoryEntry["reason"], review?: Review) {
      await this.appendHistory(plan, reason, review)
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
