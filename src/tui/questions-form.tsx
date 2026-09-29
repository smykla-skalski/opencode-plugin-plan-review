import type { Plugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal, For, Show } from "solid-js"
import type { Question, Questions } from "../schema.ts"
import type { State } from "./api.ts"
import { initialAnswers, optionsOf, toggle, type AnswerDraft } from "./draft.ts"

type Ctx = Plugin.Context

export function QuestionsForm(props: { ctx: Ctx; state: State; panel: PanelInput; questions: Questions }) {
  const theme = props.ctx.theme
  const sessionID = () => props.questions.sessionID
  const [focus, setFocus] = createSignal({ question: 0, option: 0 })

  const draft = createMemo((): AnswerDraft => {
    const stored = props.state.drafts.answers[sessionID()]
    return stored?.id === props.questions.id ? stored : initialAnswers(props.questions)
  })
  const current = createMemo(() => props.questions.questions[focus().question])

  const setAnswer = (question: Question, values: string[]) =>
    props.state.setDrafts((state) => {
      const stored = state.answers[sessionID()]
      const target = stored?.id === props.questions.id ? stored : initialAnswers(props.questions)
      target.answers[question.id] = values
      state.answers[sessionID()] = target
    })

  const moveQuestion = (delta: number) =>
    setFocus(({ question }) => ({
      question: Math.max(0, Math.min(props.questions.questions.length - 1, question + delta)),
      option: 0,
    }))

  const moveOption = (delta: number) => {
    const question = current()
    if (!question) return
    const count = optionsOf(question).length
    if (!count) return
    setFocus((state) => ({ ...state, option: Math.max(0, Math.min(count - 1, state.option + delta)) }))
  }

  const choose = async () => {
    const question = current()
    if (!question) return
    if (question.kind === "text") {
      const value = await props.ctx.ui.dialog.prompt({
        title: question.question,
        value: draft().answers[question.id]?.[0] ?? "",
      })
      if (value !== undefined) await setAnswer(question, value.trim() ? [value.trim()] : [])
      return
    }
    const option = optionsOf(question)[focus().option]
    if (option) await setAnswer(question, toggle(question, draft().answers[question.id] ?? [], option.value))
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
      { bind: "tab,shift+j", title: "Next question", group: "Questions", run: () => moveQuestion(1) },
      { bind: "shift+tab,shift+k", title: "Previous question", group: "Questions", run: () => moveQuestion(-1) },
      { bind: "j,down", title: "Next option", group: "Questions", run: () => moveOption(1) },
      { bind: "k,up", title: "Previous option", group: "Questions", run: () => moveOption(-1) },
      { bind: "space,return", title: "Select / answer", group: "Questions", run: choose },
      { bind: "ctrl+s", title: "Send answers", group: "Questions", run: submit },
      { bind: "f", title: "Toggle fullscreen", group: "Questions", run: () => props.panel.toggleFullscreen() },
      { bind: "q,escape", title: "Close", group: "Questions", run: () => props.panel.close() },
    ],
  }))

  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1} gap={1}>
      <text attributes={TextAttributes.BOLD} fg={theme.text.base} flexShrink={0}>
        {props.questions.questions.length} question(s) before planning
      </text>
      <scrollbox flexGrow={1} scrollbarOptions={{ visible: false }}>
        <box flexDirection="column" gap={1}>
          <For each={props.questions.questions}>
            {(question, qi) => {
              const active = () => qi() === focus().question
              const answer = () => draft().answers[question.id] ?? []
              return (
                <box
                  flexDirection="column"
                  border={["left"]}
                  borderColor={active() ? theme.text.feedback.info.base : theme.border.base}
                  paddingLeft={1}
                  onMouseUp={() => setFocus({ question: qi(), option: 0 })}
                >
                  <text fg={theme.text.base} attributes={active() ? TextAttributes.BOLD : undefined}>
                    {qi() + 1}. {question.question}
                  </text>
                  <Show
                    when={question.kind !== "text"}
                    fallback={
                      <text fg={answer().length ? theme.text.base : theme.text.muted}>
                        {answer()[0] ?? "⏎ to type an answer"}
                      </text>
                    }
                  >
                    <For each={optionsOf(question)}>
                      {(option, oi) => {
                        const picked = () => answer().includes(option.value)
                        const cursor = () => active() && oi() === focus().option
                        const mark = () =>
                          question.kind === "multi" ? (picked() ? "[x]" : "[ ]") : picked() ? "(●)" : "( )"
                        const recommended = question.recommended?.includes(option.value)
                        const description = "description" in option ? option.description : undefined
                        return (
                          <text fg={cursor() ? theme.text.base : theme.text.muted}>
                            {cursor() ? "› " : "  "}
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
        </box>
      </scrollbox>
      <text fg={theme.text.muted} flexShrink={0}>
        tab next question · j/k option · space select · ⏎ type · ctrl+s send · ★ recommended
      </text>
    </box>
  )
}
