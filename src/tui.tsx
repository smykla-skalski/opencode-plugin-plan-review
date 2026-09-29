import { Plugin } from "@opencode/plugin/tui"
import { createEffect, Match, Show, Switch } from "solid-js"
import { tallyLine } from "./render.ts"
import type { ChangeReason } from "./rpc.ts"
import { createState, PANEL, type View } from "./tui/api.ts"
import { PlanPanel } from "./tui/plan-panel.tsx"
import { QuestionsForm } from "./tui/questions-form.tsx"

const notice = (reason: ChangeReason, view: View) => {
  if (reason === "questions") return `${view.questions?.questions.length ?? 0} question(s) need your answer`
  if (reason === "proposed") return `Plan v${view.plan?.version} ready for review`
  if (reason === "amended") return "The agent found more work that needs your approval"
  if (reason === "checkpoint") return "Checkpoint: check the results before the next step"
  if (reason === "done") return "Plan finished: see what changed"
  return null
}

export default Plugin.define({
  id: "smykla.plan-review",
  setup(ctx) {
    const state = createState(ctx)
    const theme = ctx.theme

    const open = (sessionID: string) => {
      const route = ctx.ui.router.current()
      if (route.type === "session" && route.sessionID === sessionID) return ctx.ui.panel.open(PANEL)
      return false
    }

    const unsubscribe = state.api.events.on("changed", async (event) => {
      const { sessionID, reason } = event.data
      const view = await state.refresh(sessionID)
      const message = notice(reason, view)
      if (!message) return
      if (!open(sessionID)) ctx.ui.toast.show({ message, variant: "info", sessionID })
      void ctx.attention.notify({ title: "Plan review", message, sound: { name: "question" } })
    })

    const ensure = (sessionID: string) => {
      if (!state.view(sessionID)) void state.refresh(sessionID).catch(() => null)
    }

    ctx.ui.slot({
      append: "app",
      render() {
        ctx.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "plan-review.open",
              title: "Open plan review",
              description: "Review the structured plan or answer the architect's questions",
              group: "Session",
              bind: "<leader>p",
              palette: true,
              slash: { name: "plan" },
              run() {
                const route = ctx.ui.router.current()
                if (route.type !== "session") {
                  ctx.ui.toast.show({ message: "Open a session first", variant: "warning" })
                  return
                }
                void state.refresh(route.sessionID).then(() => ctx.ui.panel.open(PANEL))
              },
            },
          ],
        }))
        return null
      },
    })

    ctx.ui.slot({
      append: "session.composer.top",
      render(input) {
        createEffect(() => ensure(input.sessionID))
        const view = () => state.view(input.sessionID)
        return (
          <Switch>
            <Match when={view()?.questions}>
              {(questions) => (
                <text fg={theme.text.feedback.info.base} onMouseUp={() => ctx.ui.panel.open(PANEL)}>
                  ? {questions().questions.length} question(s) waiting · /plan to answer
                </text>
              )}
            </Match>
            <Match when={view()?.plan}>
              {(plan) => (
                <text fg={theme.text.muted} onMouseUp={() => ctx.ui.panel.open(PANEL)}>
                  ▣ Plan v{plan().version} · {plan().steps.length} steps · {tallyLine(plan())} · {plan().state}
                  {plan().state === "review" ? " · /plan to review" : ""}
                </text>
              )}
            </Match>
          </Switch>
        )
      },
    })

    ctx.ui.slot({
      append: "sidebar.content",
      render(input) {
        const plan = () => state.view(input.sessionID)?.plan
        return (
          <Show when={plan()}>
            {(current) => (
              <box>
                <text fg={theme.text.base}>
                  <b>Plan</b> v{current().version}
                </text>
                <text fg={theme.text.muted}>{tallyLine(current())}</text>
              </box>
            )}
          </Show>
        )
      },
    })

    ctx.ui.slot({
      append: "session.panel",
      render(panel) {
        const view = () => (panel.name === PANEL ? state.view(panel.sessionID) : undefined)
        return (
          <Switch>
            <Match when={view()?.questions}>
              {(questions) => <QuestionsForm ctx={ctx} state={state} panel={panel} questions={questions()} />}
            </Match>
            <Match when={view()?.plan}>
              {(plan) => <PlanPanel ctx={ctx} state={state} panel={panel} plan={plan()} />}
            </Match>
            <Match when={panel.name === PANEL}>
              <text fg={theme.text.muted} paddingLeft={1}>
                No plan in this session yet. Switch to the architect agent and describe the change.
              </text>
            </Match>
          </Switch>
        )
      },
    })

    return unsubscribe
  },
})
