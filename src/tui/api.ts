import type { Plugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import { PlanRpc } from "../rpc.ts"
import type { Plan, Questions } from "../schema.ts"
import { pinned, type AnswerDraft, type PlanDraft } from "./draft.ts"

export const PANEL = "plan-review"

export interface View {
  plan: Plan | null
  questions: Questions | null
}

/** Client state shared by every slot: server views in memory, review drafts on disk so they survive restarts. */
export function createState(ctx: Plugin.Context) {
  const api = ctx.client.rpc(PlanRpc)
  const options = ctx.location ? { location: ctx.location } : undefined
  const [views, setViews] = ctx.storage.memory("views", { initial: { sessions: {} as Record<string, View> } })
  const [drafts, setDrafts] = ctx.storage.store("drafts", {
    initial: {
      plans: {} as Record<string, PlanDraft>,
      answers: {} as Record<string, AnswerDraft>,
    },
  })

  const refresh = async (sessionID: string) => {
    const view = await api.get({ sessionID }, options)
    setViews((state) => {
      state.sessions[sessionID] = view
    })
    return view
  }

  return {
    api,
    options,
    views,
    drafts,
    setDrafts,
    refresh,
    view: (sessionID: string): View | undefined => views.sessions[sessionID],
  }
}

export type State = ReturnType<typeof createState>

/** How to leave the panel for the chat, using the user's own binding for focusing the session pane. */
export function chatHint(ctx: Plugin.Context) {
  const focus = ctx.keymap.shortcuts("pane.focus.left")[0] ?? "click the chat"
  return `To chat: ${focus} or q focuses the prompt · the panel stays until the plan runs · /plan reopens it`
}

/** q in the panel: while the plan is still being shaped the panel stays and focus returns to the chat. */
export function leave(ctx: Plugin.Context, panel: PanelInput, state: State, sessionID: string) {
  if (pinned(state.view(sessionID))) ctx.keymap.dispatch("pane.focus.left")
  else panel.close()
}
