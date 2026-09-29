import type { Plugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import { SyntaxStyle, TextAttributes } from "@opentui/core"
import { createMemo, createSignal, For, Show } from "solid-js"
import type { Plan, Risk, Step, Verdict } from "../schema.ts"
import { STATUS_ICON } from "../render.ts"
import { effectiveStatus, freshDraft, toReview, type PlanDraft, type StepDraft } from "./draft.ts"
import type { State } from "./api.ts"

type Ctx = Plugin.Context

const RISK_FEEDBACK: Record<Risk, "success" | "warning" | "error"> = {
  low: "success",
  medium: "warning",
  high: "error",
}

const syntax = SyntaxStyle.create()

function alternativesTable(plan: Plan) {
  if (!plan.alternatives?.length) return null
  const rows = plan.alternatives.map(
    (alt) => `| ${alt.chosen ? "✓ " : ""}${alt.name} | ${alt.pros.join("; ")} | ${alt.cons.join("; ")} |`,
  )
  return ["| Option | Pros | Cons |", "| --- | --- | --- |", ...rows].join("\n")
}

function stepMarkdown(step: Step, draft: StepDraft | undefined) {
  const detail = draft?.edit?.detail ?? step.detail
  const parts = [detail.trim()]
  if (step.rationale) parts.push(`**Why:** ${step.rationale.trim()}`)
  if (step.files.length) parts.push(`**Files:** ${step.files.map((file) => `\`${file}\``).join(", ")}`)
  if (step.dependsOn?.length) parts.push(`**After:** ${step.dependsOn.join(", ")}`)
  if (step.diagram) parts.push(["```mermaid", step.diagram.trim(), "```"].join("\n"))
  const comment = draft?.comment ?? step.comment
  if (comment) parts.push(`> 💬 ${comment.trim().replaceAll("\n", "\n> ")}`)
  if (step.note) parts.push(`_Note:_ ${step.note}`)
  return parts.join("\n\n")
}

export function PlanPanel(props: { ctx: Ctx; state: State; panel: PanelInput; plan: Plan }) {
  const theme = props.ctx.theme
  const sessionID = () => props.plan.sessionID
  const [selected, setSelected] = createSignal(0)
  const [showSummary, setShowSummary] = createSignal(true)

  const draft = createMemo((): PlanDraft => {
    const stored = props.state.drafts.plans[sessionID()]
    return stored?.version === props.plan.version ? stored : freshDraft(props.plan)
  })
  const step = createMemo(() => props.plan.steps[Math.min(selected(), props.plan.steps.length - 1)])
  const reviewing = () => props.plan.state === "review"

  const mutate = (id: string, change: (step: StepDraft) => void) =>
    props.state.setDrafts((state) => {
      const current = state.plans[sessionID()]
      const target = current?.version === props.plan.version ? current : freshDraft(props.plan)
      state.plans[sessionID()] = target
      const entry = target.steps[id] ?? {}
      change(entry)
      target.steps[id] = entry
    })

  const verdict = (value: Verdict) => {
    const current = step()
    if (!current || !reviewing()) return
    void mutate(current.id, (entry) => {
      entry.verdict = entry.verdict === value ? undefined : value
    })
  }

  const approveAll = () =>
    props.plan.steps.forEach((item) => {
      void mutate(item.id, (entry) => {
        entry.verdict = entry.verdict ?? "approve"
      })
    })

  const comment = async () => {
    const current = step()
    if (!current) return
    const value = await props.ctx.ui.dialog.prompt({
      title: `Comment on ${current.id}. ${current.title}`,
      value: draft().steps[current.id]?.comment ?? "",
    })
    if (value === undefined) return
    await mutate(current.id, (entry) => {
      entry.comment = value.trim() || undefined
    })
  }

  const edit = async () => {
    const current = step()
    if (!current || !reviewing()) return
    const value = await props.ctx.ui.dialog.prompt({
      title: `Edit ${current.id}. ${current.title}`,
      description: "Rewrite what this step should do. An edited step counts as approved.",
      value: draft().steps[current.id]?.edit?.detail ?? current.detail,
    })
    if (value === undefined || value.trim() === current.detail.trim()) return
    await mutate(current.id, (entry) => {
      entry.edit = { ...entry.edit, detail: value }
    })
  }

  const note = async () => {
    const value = await props.ctx.ui.dialog.prompt({ title: "General feedback on the plan", value: draft().note ?? "" })
    if (value === undefined) return
    await props.state.setDrafts((state) => {
      const target = state.plans[sessionID()] ?? freshDraft(props.plan)
      target.note = value.trim() || undefined
      state.plans[sessionID()] = target
    })
  }

  const submit = async (action: "revise" | "execute") => {
    if (!reviewing()) return
    if (action === "execute") {
      const approved = props.plan.steps.filter((item) => effectiveStatus(item, draft().steps[item.id]) === "approved")
      const confirmed = await props.ctx.ui.dialog.confirm({
        title: "Execute approved steps?",
        message: `${approved.length} of ${props.plan.steps.length} steps run on the build agent. The rest are skipped.`,
        label: { confirm: "Execute" },
      })
      if (!confirmed) return
    }
    const result = await props.state.api.review(toReview(props.plan, draft(), action), props.state.options)
    if (!result.ok) {
      props.ctx.ui.toast.show({ message: result.error ?? "Review failed", variant: "error" })
      return
    }
    await props.state.setDrafts((state) => {
      delete state.plans[sessionID()]
    })
    props.ctx.ui.toast.show({
      message: action === "execute" ? "Executing approved steps" : "Review sent; the agent is revising",
      variant: "success",
    })
    await props.state.refresh(sessionID())
    if (action === "revise") props.panel.close()
  }

  const move = (delta: number) =>
    setSelected((index) => Math.max(0, Math.min(props.plan.steps.length - 1, index + delta)))

  props.ctx.keymap.layer(() => ({
    enabled: () => props.panel.focused,
    priority: 50,
    commands: [
      { bind: "j,down", title: "Next step", group: "Plan", run: () => move(1) },
      { bind: "k,up", title: "Previous step", group: "Plan", run: () => move(-1) },
      { bind: "a", title: "Approve step", group: "Plan", run: () => verdict("approve") },
      { bind: "r", title: "Reject step", group: "Plan", run: () => verdict("reject") },
      { bind: "v", title: "Ask to revise step", group: "Plan", run: () => verdict("revise") },
      { bind: "shift+a", title: "Approve all undecided", group: "Plan", run: approveAll },
      { bind: "c", title: "Comment on step", group: "Plan", run: comment },
      { bind: "e", title: "Edit step", group: "Plan", run: edit },
      { bind: "n", title: "General feedback", group: "Plan", run: note },
      { bind: "s", title: "Send review (revise)", group: "Plan", run: () => submit("revise") },
      { bind: "x", title: "Execute approved steps", group: "Plan", run: () => submit("execute") },
      { bind: "o", title: "Toggle summary", group: "Plan", run: () => setShowSummary((value) => !value) },
      { bind: "f", title: "Toggle fullscreen", group: "Plan", run: () => props.panel.toggleFullscreen() },
      { bind: "q,escape", title: "Close plan", group: "Plan", run: () => props.panel.close() },
    ],
  }))

  const counts = createMemo(() => {
    const result = { approved: 0, rejected: 0, revise: 0, other: 0, comments: 0 }
    for (const item of props.plan.steps) {
      const entry = draft().steps[item.id]
      const status = effectiveStatus(item, entry)
      if (status === "approved" || status === "rejected" || status === "revise") result[status] += 1
      else result.other += 1
      if (entry?.comment) result.comments += 1
    }
    return result
  })

  const statusColor = (status: Step["status"]) => {
    if (status === "approved" || status === "done") return theme.text.feedback.success.base
    if (status === "rejected" || status === "blocked") return theme.text.feedback.error.base
    if (status === "revise") return theme.text.feedback.warning.base
    if (status === "in_progress") return theme.text.feedback.info.base
    return theme.text.muted
  }

  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1} gap={1}>
      <box flexDirection="row" gap={2} flexShrink={0}>
        <text attributes={TextAttributes.BOLD} fg={theme.text.base} flexGrow={1} truncate wrapMode="none">
          {props.plan.title}
        </text>
        <text fg={theme.text.muted} flexShrink={0}>
          v{props.plan.version} · {props.plan.state}
        </text>
      </box>

      <Show when={showSummary()}>
        <box flexShrink={0}>
          <markdown
            content={props.plan.summary}
            syntaxStyle={syntax}
            conceal
            fg={theme.markdown.text}
            tableOptions={{ style: "grid", cellPaddingX: 1 }}
          />
          <Show when={props.plan.diagram}>
            {(diagram) => (
              <markdown
                content={["```mermaid", diagram().trim(), "```"].join("\n")}
                syntaxStyle={syntax}
                fg={theme.markdown.text}
              />
            )}
          </Show>
          <Show when={alternativesTable(props.plan)}>
            {(table) => (
              <markdown
                content={table()}
                syntaxStyle={syntax}
                fg={theme.markdown.text}
                tableOptions={{ style: "grid", cellPaddingX: 1 }}
              />
            )}
          </Show>
        </box>
      </Show>

      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg={theme.text.muted} flexGrow={1}>
          Steps
        </text>
        <text>
          <span style={{ fg: theme.text.feedback.success.base }}>{counts().approved}✓ </span>
          <span style={{ fg: theme.text.feedback.error.base }}>{counts().rejected}✗ </span>
          <span style={{ fg: theme.text.feedback.warning.base }}>{counts().revise}✎ </span>
          <span style={{ fg: theme.text.muted }}>
            {counts().other}· {counts().comments}💬
          </span>
        </text>
      </box>

      <box flexDirection="column" flexShrink={0}>
        <For each={props.plan.steps}>
          {(item, index) => {
            const entry = () => draft().steps[item.id]
            const status = () => effectiveStatus(item, entry())
            const active = () => index() === selected()
            return (
              <box
                flexDirection="row"
                gap={1}
                backgroundColor={active() ? theme.background.raised.high : undefined}
                onMouseUp={() => setSelected(index())}
              >
                <text fg={theme.text.base} flexShrink={0}>
                  {active() ? "›" : " "}
                </text>
                <text fg={statusColor(status())} flexShrink={0}>
                  {STATUS_ICON[status()]}
                </text>
                <text fg={theme.text.base} flexGrow={1} truncate wrapMode="none">
                  {item.id}. {entry()?.edit?.title ?? item.title}
                </text>
                <text fg={theme.text.feedback[RISK_FEEDBACK[item.risk]].base} flexShrink={0}>
                  [{item.risk.toUpperCase()}]
                </text>
                <text fg={theme.text.muted} flexShrink={0}>
                  {item.files.length}f{entry()?.comment || item.comment ? " 💬" : ""}
                  {entry()?.edit ? " ✎" : ""}
                </text>
              </box>
            )
          }}
        </For>
      </box>

      <Show when={step()}>
        {(current) => (
          <scrollbox flexGrow={1} scrollbarOptions={{ visible: false }}>
            <box paddingTop={1}>
              <text attributes={TextAttributes.BOLD} fg={theme.text.base}>
                {current().id}. {draft().steps[current().id]?.edit?.title ?? current().title}
              </text>
              <markdown
                content={stepMarkdown(current(), draft().steps[current().id])}
                syntaxStyle={syntax}
                conceal
                fg={theme.markdown.text}
              />
            </box>
          </scrollbox>
        )}
      </Show>

      <text fg={theme.text.muted} flexShrink={0}>
        {reviewing()
          ? "j/k move · a approve · r reject · v revise · e edit · c comment · A approve all · n note · s send · x execute · q close"
          : "j/k move · c comment · f fullscreen · q close"}
      </text>
    </box>
  )
}
