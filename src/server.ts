import type { Agent, Plugin } from "@opencode/plugin"
import { covered } from "./gate.ts"
import { amend, approvedFiles, editedFiles, propose, recordTouch, review, updateStep, type Result } from "./plan.ts"
import {
  AMEND_DESCRIPTION,
  ARCHITECT_SYSTEM,
  AUTO_PLAN_HINT,
  ASK_DESCRIPTION,
  PROPOSE_DESCRIPTION,
  STEP_DESCRIPTION,
} from "./prompt.ts"
import { answersMessage, buildReminder, digestMarkdown, planMarkdown, reviewMessage } from "./render.ts"
import { PlanRpc, type ChangeReason } from "./rpc.ts"
import {
  AmendSchema,
  OptionsSchema,
  PlanInputSchema,
  QuestionsInputSchema,
  StepUpdateSchema,
  type Plan,
} from "./schema.ts"
import { createStore } from "./store.ts"

const TOOL = { propose: "plan_propose", ask: "plan_ask", step: "plan_step", amend: "plan_amend" } as const
const EXECUTION_TOOLS = [TOOL.step, TOOL.amend] as const
const PAUSED = "The plan is paused for the user's review. End your turn now."
const ARCHITECT_NAME = "Architect" as Agent.Name
const DIRECT = { codemode: false } as const
const EDIT_TOOLS: ReadonlySet<string> = new Set(["edit", "write", "patch"])

const wrap = (result: Result<Plan>): Result<{ readonly plan: Plan }> =>
  result.ok ? { ok: true, value: { plan: result.value } } : result
const missing = (error: string): Result<never> => ({ ok: false, error })

const plugin: Plugin.Plugin = {
  id: "smykla.plan-review",
  async setup(ctx) {
    const options = OptionsSchema.parse(ctx.options ?? {})
    const store = createStore(ctx.storage)
    const directory = ctx.location.directory
    const planners = new Set([options.agent, options.buildAgent])

    const registration = await ctx.rpc.register(PlanRpc, {
      async get({ sessionID }) {
        return { plan: (await store.plan(sessionID)) ?? null, questions: (await store.questions(sessionID)) ?? null }
      },
      async review(input) {
        const next = await store.exclusive(input.sessionID, async () => {
          const plan = await store.plan(input.sessionID)
          if (!plan) return { ok: false as const, error: "No plan for this session." }
          const result = review(plan, input)
          if (result.ok) await store.savePlan(result.value)
          return result
        })
        if (!next.ok) return { ok: false, error: next.error }
        await changed(input.sessionID, "reviewed", next.value.version)
        const message = reviewMessage(next.value, input)
        if (input.action === "execute")
          await ctx.session.switchAgent({ sessionID: input.sessionID, agent: options.buildAgent })
        await ctx.session.synthetic({ sessionID: input.sessionID, ...message, resume: true })
        return { ok: true }
      },
      async answer(input) {
        const questions = await store.exclusive(input.sessionID, async () => {
          const pending = await store.questions(input.sessionID)
          if (pending?.id !== input.id) return null
          await store.clearQuestions(input.sessionID)
          return pending
        })
        if (!questions) return { ok: false, error: "These questions are no longer pending." }
        await changed(input.sessionID, "answered")
        await ctx.session.synthetic({ sessionID: input.sessionID, ...answersMessage(questions, input), resume: true })
        return { ok: true }
      },
    })

    const changed = (sessionID: string, reason: ChangeReason, version?: number) =>
      registration.events.emit("changed", { sessionID, reason, version })

    const transition = async <A extends { readonly plan: Plan }>(
      sessionID: string,
      apply: (plan: Plan | undefined) => Result<A>,
    ) => {
      const next = await store.exclusive(sessionID, async () => {
        const result = apply(await store.plan(sessionID))
        if (result.ok) await store.savePlan(result.value.plan)
        return result
      })
      return next
    }

    await ctx.agent.transform((editor) => {
      editor.update(options.agent, (agent) => {
        agent.name = ARCHITECT_NAME
        agent.description = "Plans changes as structured, reviewable steps. Never edits files."
        agent.mode = "primary"
        agent.system = ARCHITECT_SYSTEM
        agent.permissions.push(
          { action: "edit", resource: "*", effect: "deny" },
          { action: "question", resource: "*", effect: "deny" },
        )
      })
    })

    await ctx.tool.transform((editor) => {
      editor.add({
        name: TOOL.propose,
        description: PROPOSE_DESCRIPTION,
        input: PlanInputSchema,
        options: DIRECT,
        async execute(input, context) {
          if (!planners.has(context.agent)) return { content: `Only ${[...planners].join(" or ")} can propose plans.` }
          const next = await transition(context.sessionID, (previous) =>
            wrap(propose(previous, input, context.sessionID, Date.now())),
          )
          if (!next.ok) return { content: `Plan rejected: ${next.error}` }
          const { plan } = next.value
          await changed(plan.sessionID, "proposed", plan.version)
          return {
            content: `${planMarkdown(plan)}\n\nPlan v${plan.version} is in the user's review panel. End your turn now.`,
            metadata: { version: plan.version, steps: plan.steps.length },
          }
        },
      })
      editor.add({
        name: TOOL.ask,
        description: ASK_DESCRIPTION,
        input: QuestionsInputSchema,
        options: DIRECT,
        async execute(input, context) {
          const invalid = input.questions.filter((q) => q.kind !== "text" && q.kind !== "confirm" && !q.options?.length)
          if (invalid.length) return { content: `Questions ${invalid.map((q) => q.id).join(", ")} need options.` }
          await store.exclusive(context.sessionID, () =>
            store.saveQuestions({ ...input, id: `q${Date.now()}`, sessionID: context.sessionID }),
          )
          await changed(context.sessionID, "questions")
          return { content: "The questions are in the user's review panel. End your turn and wait for <plan-answers>." }
        },
      })
      editor.add({
        name: TOOL.step,
        description: STEP_DESCRIPTION,
        input: StepUpdateSchema,
        options: DIRECT,
        async execute(input, context) {
          const next = await transition(context.sessionID, (plan) =>
            plan ? wrap(updateStep(plan, input, options.checkpoint)) : missing("There is no plan in this session."),
          )
          if (!next.ok) return { content: next.error }
          const { plan } = next.value
          const { state } = plan
          await changed(plan.sessionID, state === "done" ? "done" : state === "review" ? "checkpoint" : "step", plan.version)
          const metadata = { step: input.stepID, status: input.status }
          if (state === "done")
            return { content: `All approved steps are finished.\n\n${digestMarkdown(plan, directory)}`, metadata }
          if (state === "review") return { content: `${input.stepID} → ${input.status}. Checkpoint: ${PAUSED}`, metadata }
          return { content: `${input.stepID} → ${input.status}`, metadata }
        },
      })
      editor.add({
        name: TOOL.amend,
        description: AMEND_DESCRIPTION,
        input: AmendSchema,
        options: DIRECT,
        async execute(input, context) {
          const next = await transition(context.sessionID, (plan) =>
            plan ? amend(plan, input, directory) : missing("There is no plan in this session; use plan_propose."),
          )
          if (!next.ok) return { content: next.error }
          await changed(context.sessionID, next.value.paused ? "amended" : "step", next.value.plan.version)
          const ids = input.steps.map((step) => step.id).join(", ")
          return {
            content: next.value.paused
              ? `Added ${ids}; some need the user's approval. ${PAUSED}`
              : `Added ${ids}, approved automatically because they stay within approved files. Continue.`,
            metadata: { paused: next.value.paused, steps: input.steps.length },
          }
        },
      })
    })

    await ctx.session.hook("context", async (event) => {
      if (!planners.has(event.agent)) {
        for (const tool of Object.values(TOOL)) delete event.tools[tool]
        return
      }
      delete event.tools.question
      if (event.agent === options.agent) {
        for (const tool of EXECUTION_TOOLS) delete event.tools[tool]
        return
      }
      const plan = await store.plan(event.sessionID)
      if (plan?.state !== "executing") {
        for (const tool of EXECUTION_TOOLS) delete event.tools[tool]
        if (options.autoPlan && plan?.state !== "review") event.system.push({ type: "text", text: AUTO_PLAN_HINT })
        return
      }
      event.system.push({ type: "text", text: buildReminder(plan) })
    })

    await ctx.permission.hook("evaluate", async (event) => {
      if (event.action !== "edit" || event.agent !== options.buildAgent) return
      if (options.gate === "off" || event.effect === "deny") return
      const plan = await store.plan(event.sessionID)
      if (plan?.state !== "executing") return
      const files = approvedFiles(plan)
      const outside = event.resources.filter((resource) => !covered(resource, files, directory))
      if (!outside.length) return
      event.effect = options.gate
      event.message = `Not covered by approved plan v${plan.version}: ${outside.join(", ")}. Consider plan_amend.`
    })

    await ctx.tool.hook("execute.after", async (event) => {
      if (event.status !== "completed" || event.agent !== options.buildAgent || !EDIT_TOOLS.has(event.tool)) return
      const files = editedFiles(event.result.output)
      if (!files.length) return
      await store.exclusive(event.sessionID, async () => {
        const plan = await store.plan(event.sessionID)
        if (plan?.state === "executing") await store.savePlan(recordTouch(plan, files, directory))
      })
    })
  },
}

export default plugin
