import { Agent, Plugin } from "@opencode/plugin"
import { covered } from "./gate.ts"
import { amend, approvedFiles, propose, recordTouch, review, updateStep } from "./plan.ts"
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

export default Plugin.define({
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
        const plan = await store.plan(input.sessionID)
        if (!plan) return { ok: false, error: "No plan for this session." }
        const next = review(plan, input)
        if (!next.ok) return { ok: false, error: next.error }
        await store.savePlan(next.value)
        await changed(input.sessionID, "reviewed", next.value.version)
        const message = reviewMessage(next.value, input)
        if (input.action === "execute")
          await ctx.session.switchAgent({ sessionID: input.sessionID, agent: options.buildAgent })
        await ctx.session.synthetic({ sessionID: input.sessionID, ...message, resume: true })
        return { ok: true }
      },
      async answer(input) {
        const questions = await store.questions(input.sessionID)
        if (questions?.id !== input.id) return { ok: false, error: "These questions are no longer pending." }
        await store.clearQuestions(input.sessionID)
        await changed(input.sessionID, "answered")
        await ctx.session.synthetic({ sessionID: input.sessionID, ...answersMessage(questions, input), resume: true })
        return { ok: true }
      },
    })

    const changed = (sessionID: string, reason: ChangeReason, version?: number) =>
      registration.events.emit("changed", { sessionID, reason, version })

    const saveAndAnnounce = async (plan: Plan, reason: ChangeReason) => {
      await store.savePlan(plan)
      await changed(plan.sessionID, reason, plan.version)
    }

    await ctx.agent.transform((editor) => {
      editor.update(options.agent, (agent) => {
        agent.name = Agent.Name.make("Architect")
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
        async execute(input, context) {
          if (!planners.has(context.agent)) return { content: `Only ${[...planners].join(" or ")} can propose plans.` }
          const next = propose(await store.plan(context.sessionID), input, context.sessionID, Date.now())
          if (!next.ok) return { content: `Plan rejected: ${next.error}` }
          await saveAndAnnounce(next.value, "proposed")
          return {
            content: `${planMarkdown(next.value)}\n\nPlan v${next.value.version} is in the user's review panel. End your turn now.`,
            metadata: { version: next.value.version, steps: next.value.steps.length },
          }
        },
      })
      editor.add({
        name: TOOL.ask,
        description: ASK_DESCRIPTION,
        input: QuestionsInputSchema,
        async execute(input, context) {
          const invalid = input.questions.filter((q) => q.kind !== "text" && q.kind !== "confirm" && !q.options?.length)
          if (invalid.length) return { content: `Questions ${invalid.map((q) => q.id).join(", ")} need options.` }
          await store.saveQuestions({ ...input, id: `q${Date.now()}`, sessionID: context.sessionID })
          await changed(context.sessionID, "questions")
          return { content: "The questions are in the user's review panel. End your turn and wait for <plan-answers>." }
        },
      })
      editor.add({
        name: TOOL.step,
        description: STEP_DESCRIPTION,
        input: StepUpdateSchema,
        async execute(input, context) {
          const plan = await store.plan(context.sessionID)
          if (!plan) return { content: "There is no plan in this session." }
          const next = updateStep(plan, input, options.checkpoint)
          if (!next.ok) return { content: next.error }
          const { state } = next.value
          await saveAndAnnounce(next.value, state === "done" ? "done" : state === "review" ? "checkpoint" : "step")
          const metadata = { step: input.stepID, status: input.status }
          if (state === "done")
            return { content: `All approved steps are finished.\n\n${digestMarkdown(next.value, directory)}`, metadata }
          if (state === "review") return { content: `${input.stepID} → ${input.status}. Checkpoint: ${PAUSED}`, metadata }
          return { content: `${input.stepID} → ${input.status}`, metadata }
        },
      })
      editor.add({
        name: TOOL.amend,
        description: AMEND_DESCRIPTION,
        input: AmendSchema,
        async execute(input, context) {
          const plan = await store.plan(context.sessionID)
          if (!plan) return { content: "There is no plan in this session; use plan_propose." }
          const next = amend(plan, input, directory)
          if (!next.ok) return { content: next.error }
          await saveAndAnnounce(next.value.plan, next.value.paused ? "amended" : "step")
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
      const plan = await store.plan(event.sessionID)
      if (plan?.state !== "executing") return
      await store.savePlan(recordTouch(plan, event.resources, directory))
      if (options.gate === "off" || event.effect === "deny") return
      const files = approvedFiles(plan)
      const outside = event.resources.filter((resource) => !covered(resource, files, directory))
      if (!outside.length) return
      event.effect = options.gate
      event.message = `Not covered by approved plan v${plan.version}: ${outside.join(", ")}. Consider plan_amend.`
    })
  },
})
