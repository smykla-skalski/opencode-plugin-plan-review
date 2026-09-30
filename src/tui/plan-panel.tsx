/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import { SyntaxStyle, TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { attention, drift } from "../plan.ts"
import { CHECK_ICON, digestMarkdown, STATUS_ICON } from "../render.ts"
import type { Plan, ReviewReason, Risk, Step, Verdict } from "../schema.ts"
import { chatHint, type State } from "./api.ts"
import { DiagramView } from "./diagram-view.tsx"
import { effectiveStatus, freshDraft, isFinished, toReview, type PlanDraft, type StepDraft } from "./draft.ts"

type Ctx = Plugin.Context

const RISK_FEEDBACK: Record<Risk, "success" | "warning" | "error"> = {
  low: "success",
  medium: "warning",
  high: "error",
}

const BANNER: Record<ReviewReason, string> = {
  plan: "Review the plan",
  amendment: "⚑ The agent found more work: approve the new steps to continue",
  checkpoint: "⏸ Checkpoint: check the results before the next step",
}

const syntax = SyntaxStyle.create()
const DETAIL_ID = "plan-review-detail"
const rowID = (stepID: string) => `plan-review-step-${stepID}`

const HELP = [
  "↑/↓ pick a step; past the ends they scroll · pgup/pgdn page · g/G top/bottom",
  "←/→ pan a wide diagram · f fullscreen · o hide or show the summary",
  "a approve · r reject · v ask to revise · e edit · c comment · A approve all undecided",
  "n general feedback · . show or fold routine steps · d open the diff viewer",
  "s send the review back to the agent · x run the approved steps · q close",
]

function Section(props: { theme: Ctx["theme"]; title: string; aside?: string }) {
  return (
    <box flexDirection="row" flexShrink={0} paddingTop={1}>
      <text attributes={TextAttributes.BOLD} fg={props.theme.text.feedback.info.base} flexGrow={1}>
        {props.title.toUpperCase()}
      </text>
      <Show when={props.aside}>
        <text fg={props.theme.text.muted}>{props.aside}</text>
      </Show>
    </box>
  )
}

function Alternatives(props: { theme: Ctx["theme"]; plan: Plan }) {
  return (
    <For each={props.plan.alternatives ?? []}>
      {(alt) => (
        <box flexDirection="column" flexShrink={0} paddingBottom={1}>
          <text
            fg={alt.chosen ? props.theme.text.base : props.theme.text.muted}
            attributes={alt.chosen ? TextAttributes.BOLD : undefined}
          >
            {alt.chosen ? "✓ " : "  "}
            {alt.name}
            {alt.chosen ? "  (chosen)" : ""}
          </text>
          <For each={alt.pros}>
            {(pro) => <text fg={props.theme.text.feedback.success.base}>{`    + ${pro}`}</text>}
          </For>
          <For each={alt.cons}>
            {(con) => <text fg={props.theme.text.feedback.error.base}>{`    − ${con}`}</text>}
          </For>
        </box>
      )}
    </For>
  )
}

function stepMarkdown(step: Step, draft: StepDraft | undefined, directory: string) {
  const parts: string[] = []
  if (step.needsYou) parts.push(`**⚑ Decide:** ${step.needsYou}`)
  parts.push((draft?.edit?.detail ?? step.detail).trim())
  if (step.rationale) parts.push(`**Why:** ${step.rationale.trim()}`)
  if (step.files.length) parts.push(`**Files:** ${step.files.map((file) => `\`${file}\``).join(", ")}`)
  if (step.dependsOn?.length) parts.push(`**After:** ${step.dependsOn.join(", ")}`)
  if (step.check) {
    const command = step.check.command ? ` (\`${step.check.command}\`)` : ""
    parts.push(`**Check:** ${CHECK_ICON[step.check.outcome]} ${step.check.summary}${command}`)
  }
  if (step.touched.length) parts.push(`**Touched:** ${step.touched.map((file) => `\`${file}\``).join(", ")}`)
  const off = drift(step, directory)
  if (off.length) parts.push(`**⚠ Outside this step's files:** ${off.join(", ")}`)
  const comment = draft?.comment ?? step.comment
  if (comment) parts.push(`> 💬 ${comment.trim().replaceAll("\n", "\n> ")}`)
  if (step.note) parts.push(`_Note:_ ${step.note}`)
  return parts.join("\n\n")
}

export function PlanPanel(props: { ctx: Ctx; state: State; panel: PanelInput; plan: Plan }) {
  const theme = props.ctx.theme
  const directory = props.ctx.location?.directory ?? ""
  const sessionID = () => props.plan.sessionID
  const [selected, setSelected] = createSignal(0)
  const [showSummary, setShowSummary] = createSignal(true)
  const [showAll, setShowAll] = createSignal(false)
  const [offset, setOffset] = createSignal(0)
  const [help, setHelp] = createSignal(false)
  const diagramWidth = () => Math.max(20, props.panel.width - 4)

  const draft = createMemo((): PlanDraft => {
    const stored = props.state.drafts.plans[sessionID()]
    return stored?.version === props.plan.version ? stored : freshDraft(props.plan)
  })
  const reviewing = () => props.plan.state === "review"

  const flagged = (item: Step) =>
    attention(item) || Boolean(draft().steps[item.id]) || item.status === "in_progress"
  const visible = createMemo(() => {
    if (showAll()) return props.plan.steps
    const shown = props.plan.steps.filter(flagged)
    return shown.length ? shown : props.plan.steps
  })
  const folded = createMemo(() => props.plan.steps.length - visible().length)
  const step = createMemo(() => visible()[Math.min(selected(), visible().length - 1)])

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
    if (!current || !reviewing() || isFinished(current)) return
    void mutate(current.id, (entry) => {
      entry.verdict = entry.verdict === value ? undefined : value
    })
  }

  const approveAll = () =>
    props.plan.steps
      .filter((item) => item.status === "proposed" && !draft().steps[item.id]?.verdict)
      .forEach((item) => {
        void mutate(item.id, (entry) => {
          entry.verdict = "approve"
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
    if (!current || !reviewing() || isFinished(current)) return
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
      const status = (item: Step) => effectiveStatus(item, draft().steps[item.id])
      const pending = props.plan.steps.filter((item) => status(item) === "approved")
      const skipped = props.plan.steps.filter((item) => ["proposed", "rejected", "revise"].includes(status(item)))
      const hidden = skipped.filter((item) => !visible().includes(item)).length
      const resuming = props.plan.reviewReason !== "plan"
      const skipLine = skipped.length
        ? ` Skipped (not approved): ${skipped.map((item) => item.id).join(", ")}${hidden ? `, ${hidden} of them folded; press A to approve all or . to show them` : ""}.`
        : ""
      const confirmed = await props.ctx.ui.dialog.confirm({
        title: resuming ? "Continue execution?" : "Execute approved steps?",
        message: `${pending.length} approved step(s) left to run on the build agent.${skipLine}`,
        label: { confirm: resuming ? "Continue" : "Execute" },
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
      message: action === "execute" ? "Executing approved steps" : "Review sent; the agent is adjusting",
      variant: "success",
    })
    await props.state.refresh(sessionID())
    if (action === "revise") props.panel.close()
  }

  let scroll: ScrollBoxRenderable | undefined
  const page = () => Math.max(3, (scroll?.height ?? 20) - 2)
  /** Arrows pick steps; past the first or last step they scroll, reaching the summary above and the detail below. */
  const move = (delta: number) => {
    const next = selected() + delta
    if (next < 0 || next >= visible().length) {
      scroll?.scrollBy(delta * 3)
      return
    }
    setSelected(next)
    const current = step()
    if (current) scroll?.scrollChildIntoView(rowID(current.id))
  }

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
      { bind: "x", title: "Execute / continue", group: "Plan", run: () => submit("execute") },
      { bind: ".", title: "Show or fold routine steps", group: "Plan", run: () => setShowAll((value) => !value) },
      { bind: "d", title: "Open diff viewer", group: "Plan", run: () => props.ctx.keymap.dispatch("diff.open") },
      { bind: "right,l", title: "Pan diagram right", group: "Plan", run: () => setOffset((at) => at + 12) },
      { bind: "left,h", title: "Pan diagram left", group: "Plan", run: () => setOffset((at) => Math.max(0, at - 12)) },
      { bind: "?", title: "Show keys", group: "Plan", run: () => setHelp((value) => !value) },
      { bind: "pagedown,ctrl+d", title: "Scroll down", group: "Plan", run: () => scroll?.scrollBy(page()) },
      { bind: "pageup,ctrl+u", title: "Scroll up", group: "Plan", run: () => scroll?.scrollBy(-page()) },
      { bind: "home,g", title: "Scroll to top", group: "Plan", run: () => scroll?.scrollTo(0) },
      { bind: "end,shift+g", title: "Scroll to bottom", group: "Plan", run: () => scroll?.scrollTo(scroll.scrollHeight) },
      { bind: "o", title: "Toggle summary", group: "Plan", run: () => setShowSummary((value) => !value) },
      { bind: "f", title: "Toggle fullscreen", group: "Plan", run: () => props.panel.toggleFullscreen() },
      { bind: "q,escape", title: "Close plan", group: "Plan", run: () => props.panel.close() },
    ],
  }))

  const counts = createMemo(() => {
    const result = { approved: 0, rejected: 0, revise: 0, done: 0, other: 0, comments: 0 }
    for (const item of props.plan.steps) {
      const entry = draft().steps[item.id]
      const status = effectiveStatus(item, entry)
      if (status === "approved" || status === "rejected" || status === "revise" || status === "done")
        result[status] += 1
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

  const checkColor = (outcome: "pass" | "fail" | "none") =>
    outcome === "pass"
      ? theme.text.feedback.success.base
      : outcome === "fail"
        ? theme.text.feedback.error.base
        : theme.text.muted

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

      <Show when={reviewing()}>
        <text
          flexShrink={0}
          fg={props.plan.reviewReason === "plan" ? theme.text.muted : theme.text.feedback.warning.base}
        >
          {BANNER[props.plan.reviewReason]}
        </text>
      </Show>

      <scrollbox
        ref={(element: ScrollBoxRenderable) => (scroll = element)}
        flexGrow={1}
        verticalScrollbarOptions={{ visible: true }}
        horizontalScrollbarOptions={{ visible: false }}
      >
      <Switch>
        <Match when={props.plan.state === "done"}>
          <markdown
            content={digestMarkdown(props.plan, directory)}
            syntaxStyle={syntax}
            conceal
            fg={theme.markdown.text}
          />
        </Match>
        <Match when={props.plan.state !== "done"}>
          <Show when={showSummary() && props.plan.reviewReason === "plan"}>
            <box flexShrink={0} flexDirection="column">
              <Section theme={theme} title="Summary" aside="o hides" />
              <markdown content={props.plan.summary} syntaxStyle={syntax} conceal fg={theme.markdown.text} />
              <Show when={props.plan.diagram}>
                {(diagram) => (
                  <>
                    <Section theme={theme} title="Diagram" />
                    <DiagramView theme={theme} source={diagram()} width={diagramWidth()} offset={offset()} />
                  </>
                )}
              </Show>
              <Show when={props.plan.alternatives?.length}>
                <Section theme={theme} title="Alternatives considered" />
                <Alternatives theme={theme} plan={props.plan} />
              </Show>
            </box>
          </Show>

          <Section theme={theme} title={`Steps (${props.plan.steps.length})`} />
          <text flexShrink={0}>
            <span style={{ fg: theme.text.feedback.success.base }}>{counts().approved} approved</span>
            <span style={{ fg: theme.text.muted }}> · </span>
            <span style={{ fg: theme.text.feedback.error.base }}>{counts().rejected} rejected</span>
            <span style={{ fg: theme.text.muted }}> · </span>
            <span style={{ fg: theme.text.feedback.warning.base }}>{counts().revise} to revise</span>
            <span style={{ fg: theme.text.muted }}> · {counts().other} undecided</span>
            <Show when={counts().done}>
              <span style={{ fg: theme.text.feedback.success.base }}> · {counts().done} done</span>
            </Show>
            <Show when={counts().comments}>
              <span style={{ fg: theme.text.muted }}> · {counts().comments} commented</span>
            </Show>
          </text>

          <box flexDirection="column" flexShrink={0}>
            <For each={visible()}>
              {(item, index) => {
                const entry = () => draft().steps[item.id]
                const status = () => effectiveStatus(item, entry())
                const active = () => index() === selected()
                const off = () => drift(item, directory).length > 0
                return (
                  <box
                    id={rowID(item.id)}
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
                    <text fg={theme.text.feedback.warning.base} flexShrink={0}>
                      {item.needsYou ? "⚑" : item.origin === "amendment" ? "+" : " "}
                    </text>
                    <text fg={theme.text.base} flexGrow={1} truncate wrapMode="none">
                      {item.id}. {entry()?.edit?.title ?? item.title}
                    </text>
                    <Show when={item.check}>
                      {(check) => (
                        <text fg={checkColor(check().outcome)} flexShrink={0}>
                          {CHECK_ICON[check().outcome]}
                        </text>
                      )}
                    </Show>
                    <Show when={off()}>
                      <text fg={theme.text.feedback.warning.base} flexShrink={0}>
                        ⚠
                      </text>
                    </Show>
                    <text fg={theme.text.feedback[RISK_FEEDBACK[item.risk]].base} flexShrink={0}>
                      [{item.risk.toUpperCase()}]
                    </text>
                    <text fg={theme.text.muted} flexShrink={0}>
                      {item.touched.length ? `${item.touched.length}✎f` : `${item.files.length}f`}
                      {entry()?.comment || item.comment ? " 💬" : ""}
                    </text>
                  </box>
                )
              }}
            </For>
            <Show when={folded() > 0}>
              <text fg={theme.text.muted} onMouseUp={() => setShowAll(true)}>
                {"  "}+ {folded()} routine step(s) folded · . to show
              </text>
            </Show>
          </box>

          <Show when={step()}>
            {(current) => (
                <box id={DETAIL_ID} flexDirection="column">
                  <Section theme={theme} title="Selected step" />
                  <text attributes={TextAttributes.BOLD} fg={theme.text.base}>
                    {current().id}. {draft().steps[current().id]?.edit?.title ?? current().title}
                  </text>
                  <markdown
                    content={stepMarkdown(current(), draft().steps[current().id], directory)}
                    syntaxStyle={syntax}
                    conceal
                    fg={theme.markdown.text}
                  />
                  <Show when={current().diagram}>
                    {(diagram) => (
                      <DiagramView theme={theme} source={diagram()} width={diagramWidth()} offset={offset()} />
                    )}
                  </Show>
                </box>
            )}
          </Show>
        </Match>
      </Switch>
      </scrollbox>

      <Show when={help()}>
        <box flexDirection="column" flexShrink={0} paddingTop={1}>
          <For each={HELP}>{(line) => <text fg={theme.text.base}>{line}</text>}</For>
          <text fg={theme.text.muted}>{chatHint(props.ctx)}</text>
        </box>
      </Show>
      <text fg={theme.text.muted} flexShrink={0} wrapMode="none" truncate>
        {props.plan.state === "done"
          ? "↑/↓ scroll · d diff · f fullscreen · q close · ? keys"
          : reviewing()
            ? "↑/↓ steps · a/r/v decide · c comment · s send · x run · ? keys & chat"
            : "↑/↓ steps · c comment · d diff · q close · ? keys & chat"}
      </text>
    </box>
  )
}
