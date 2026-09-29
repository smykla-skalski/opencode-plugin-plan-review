import { Agent, Plugin } from "@opencode/plugin"
import { covered } from "./gate.ts"
import { approvedSteps, propose, review, updateStep } from "./plan.ts"
import { ARCHITECT_SYSTEM, ASK_DESCRIPTION, PROPOSE_DESCRIPTION, STEP_DESCRIPTION } from "./prompt.ts"
import { answersMessage, buildReminder, planMarkdown, reviewMessage } from "./render.ts"
import { PlanRpc, type ChangeReason } from "./rpc.ts"
import { OptionsSchema, PlanInputSchema, QuestionsInputSchema, StepUpdateSchema } from "./schema.ts"
import { createStore } from "./store.ts"

const TOOL = { propose: "plan_propose", ask: "plan_ask", step: "plan_step" } as const

export default Plugin.define({
  id: "smykla.plan-review",
  async setup(ctx) {
    const options = OptionsSchema.parse(ctx.options ?? {})
    const store = createStore(ctx.storage)
    const directory = ctx.location.directory

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
          if (context.agent !== options.agent) return { content: `Only the ${options.agent} agent proposes plans.` }
          const next = propose(await store.plan(context.sessionID), input, context.sessionID, Date.now())
          if (!next.ok) return { content: `Plan rejected: ${next.error}` }
          await store.savePlan(next.value)
          await changed(context.sessionID, "proposed", next.value.version)
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
          const next = updateStep(plan, input)
          if (!next.ok) return { content: next.error }
          await store.savePlan(next.value)
          await changed(context.sessionID, "step", next.value.version)
          return { content: `${input.stepID} → ${input.status}`, metadata: { step: input.stepID, status: input.status } }
        },
      })
    })

    await ctx.session.hook("context", async (event) => {
      if (event.agent === options.agent) {
        delete event.tools.question
        delete event.tools[TOOL.step]
        return
      }
      delete event.tools[TOOL.propose]
      delete event.tools[TOOL.ask]
      const plan = await store.plan(event.sessionID)
      if (plan?.state !== "executing") {
        delete event.tools[TOOL.step]
        return
      }
      if (event.agent === options.buildAgent) event.system.push({ type: "text", text: buildReminder(plan) })
    })

    await ctx.permission.hook("evaluate", async (event) => {
      if (options.gate === "off" || event.action !== "edit" || event.effect === "deny") return
      if (event.agent !== options.buildAgent) return
      const plan = await store.plan(event.sessionID)
      if (plan?.state !== "executing") return
      const files = approvedSteps(plan).flatMap((step) => step.files)
      const outside = event.resources.filter((resource) => !covered(resource, files, directory))
      if (!outside.length) return
      event.effect = options.gate
      event.message = `Not covered by approved plan v${plan.version}: ${outside.join(", ")}`
    })
  },
})
