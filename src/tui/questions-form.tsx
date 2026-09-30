/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal, For, Show } from "solid-js"
import type { Question, Questions } from "../schema.ts"
import { chatHint, type State } from "./api.ts"
import { formRows, initialAnswers, jumpQuestion, optionsOf, toggle, type AnswerDraft } from "./draft.ts"

type Ctx = Plugin.Context

export function QuestionsForm(props: { ctx: Ctx; state: State; panel: PanelInput; questions: Questions }) {
  const theme = props.ctx.theme
  const sessionID = () => props.questions.sessionID
  const rows = createMemo(() => formRows(props.questions))
  const [cursor, setCursor] = createSignal(0)
  const row = createMemo(() => rows()[Math.min(cursor(), rows().length - 1)])
  const activeQuestion = () => {
    const current = row()
    return current && current.kind !== "send" ? current.question : -1
  }

  const draft = createMemo((): AnswerDraft => {
    const stored = props.state.drafts.answers[sessionID()]
    return stored?.id === props.questions.id ? stored : initialAnswers(props.questions)
  })

  const setAnswer = (question: Question, values: string[]) =>
    props.state.setDrafts((state) => {
      const stored = state.answers[sessionID()]
      const target = stored?.id === props.questions.id ? stored : initialAnswers(props.questions)
      target.answers[question.id] = values
      state.answers[sessionID()] = target
    })

  const move = (delta: number) => setCursor((at) => Math.max(0, Math.min(rows().length - 1, at + delta)))
  const jump = (delta: 1 | -1) => setCursor((at) => jumpQuestion(rows(), at, delta))

  const typeAnswer = async (question: Question) => {
    const value = await props.ctx.ui.dialog.prompt({
      title: question.question,
      value: draft().answers[question.id]?.[0] ?? "",
    })
    if (value === undefined) return false
    await setAnswer(question, value.trim() ? [value.trim()] : [])
    return true
  }

  /** Space: toggle or pick the option under the cursor without moving. */
  const pick = async () => {
    const current = row()
    if (!current || current.kind === "send") return
    const question = props.questions.questions[current.question]
    if (!question) return
    if (current.kind === "text") {
      await typeAnswer(question)
      return
    }
    const option = optionsOf(question)[current.option]
    if (option) await setAnswer(question, toggle(question, draft().answers[question.id] ?? [], option.value))
  }

  /** Enter: accept. Picks a single choice or types a text answer, then moves to the next question; on Send, sends. */
  const accept = async () => {
    const current = row()
    if (!current) return
    if (current.kind === "send") {
      await submit()
      return
    }
    const question = props.questions.questions[current.question]
    if (!question) return
    if (current.kind === "text") {
      if (await typeAnswer(question)) jump(1)
      return
    }
    const option = optionsOf(question)[current.option]
    if (!option) return
    if (question.kind === "multi") {
      await setAnswer(question, toggle(question, draft().answers[question.id] ?? [], option.value))
      return
    }
    await setAnswer(question, [option.value])
    jump(1)
  }

  const submit = async () => {
    const unanswered = props.questions.questions.filter((question) => !draft().answers[question.id]?.length)
    if (unanswered.length) {
      const proceed = await props.ctx.ui.dialog.confirm({
        title: "Send with unanswered questions?",
        message: `${unanswered.length} question(s) have no answer; the agent sees "(no answer)".`,
        label: { confirm: "Send" },
      })
      if (!proceed) return
    }
    const result = await props.state.api.answer(
      { sessionID: sessionID(), id: props.questions.id, answers: draft().answers },
      props.state.options,
    )
    if (!result.ok) {
      props.ctx.ui.toast.show({ message: result.error ?? "Could not send answers", variant: "error" })
      return
    }
    await props.state.setDrafts((state) => {
      delete state.answers[sessionID()]
    })
    await props.state.refresh(sessionID())
    props.ctx.ui.toast.show({ message: "Answers sent", variant: "success" })
  }

  props.ctx.keymap.layer(() => ({
    enabled: () => props.panel.focused,
    priority: 50,
    commands: [
      { bind: "down,j", title: "Next option", group: "Questions", run: () => move(1) },
      { bind: "up,k", title: "Previous option", group: "Questions", run: () => move(-1) },
      { bind: "tab", title: "Next question", group: "Questions", run: () => jump(1) },
      { bind: "shift+tab", title: "Previous question", group: "Questions", run: () => jump(-1) },
      { bind: "return", title: "Accept", group: "Questions", run: accept },
      { bind: "space", title: "Toggle option", group: "Questions", run: pick },
      { bind: "ctrl+s", title: "Send answers", group: "Questions", run: submit },
      { bind: "f", title: "Toggle fullscreen", group: "Questions", run: () => props.panel.toggleFullscreen() },
      { bind: "q,escape", title: "Close", group: "Questions", run: () => props.panel.close() },
    ],
  }))

  const isCursor = (question: number, option?: number) => {
    const current = row()
    if (!current || current.kind === "send" || current.question !== question) return false
    return current.kind === "text" || current.option === option
  }

  const rowIndex = (question: number, option?: number) =>
    rows().findIndex(
      (item) =>
        item.kind !== "send" &&
        item.question === question &&
        (item.kind === "text" || item.option === option),
    )

  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1} gap={1}>
      <text attributes={TextAttributes.BOLD} fg={theme.text.base} flexShrink={0}>
        {props.questions.questions.length} question(s) before planning
      </text>
      <scrollbox flexGrow={1} scrollbarOptions={{ visible: false }}>
        <box flexDirection="column" gap={1}>
          <For each={props.questions.questions}>
            {(question, qi) => {
              const active = () => qi() === activeQuestion()
              const answer = () => draft().answers[question.id] ?? []
              return (
                <box
                  flexDirection="column"
                  border={["left"]}
                  borderColor={active() ? theme.text.feedback.info.base : theme.border.base}
                  paddingLeft={1}
                >
                  <text fg={theme.text.base} attributes={active() ? TextAttributes.BOLD : undefined}>
                    {qi() + 1}. {question.question}
                    {question.kind === "multi" ? "  (pick any)" : ""}
                  </text>
                  <Show
                    when={question.kind !== "text"}
                    fallback={
                      <text
                        fg={isCursor(qi()) ? theme.text.base : theme.text.muted}
                        onMouseUp={() => setCursor(rowIndex(qi()))}
                      >
                        {isCursor(qi()) ? "› " : "  "}
                        {answer()[0] ?? "⏎ type an answer"}
                      </text>
                    }
                  >
                    <For each={optionsOf(question)}>
                      {(option, oi) => {
                        const picked = () => answer().includes(option.value)
                        const here = () => isCursor(qi(), oi())
                        const mark = () =>
                          question.kind === "multi" ? (picked() ? "[x]" : "[ ]") : picked() ? "(●)" : "( )"
                        const recommended = question.recommended?.includes(option.value)
                        const description = "description" in option ? option.description : undefined
                        return (
                          <text fg={here() ? theme.text.base : theme.text.muted} onMouseUp={() => setCursor(rowIndex(qi(), oi()))}>
                            {here() ? "› " : "  "}
                            {mark()} {option.label}
                            {recommended ? " ★" : ""}
                            {description ? ` — ${description}` : ""}
                          </text>
                        )
                      }}
                    </For>
                  </Show>
                </box>
              )
            }}
          </For>
          <text
            attributes={TextAttributes.BOLD}
            fg={row()?.kind === "send" ? theme.text.feedback.success.base : theme.text.muted}
            onMouseUp={() => void submit()}
          >
            {row()?.kind === "send" ? "› " : "  "}[ Send answers ]
          </text>
        </box>
      </scrollbox>
      <text fg={theme.text.muted} flexShrink={0}>
        {chatHint(props.ctx)}
      </text>
      <text fg={theme.text.muted} flexShrink={0}>
        ↑/↓ move · ⏎ accept & next · space toggle · tab next question · ctrl+s send · ★ recommended
      </text>
    </box>
  )
}
