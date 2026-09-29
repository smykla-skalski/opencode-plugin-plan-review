import { approvedSteps, tally } from "./plan.ts"
import type { Answers, Plan, Questions, Review, Step } from "./schema.ts"

export const STATUS_ICON: Record<Step["status"], string> = {
  proposed: "·",
  approved: "✓",
  rejected: "✗",
  revise: "✎",
  in_progress: "▶",
  done: "●",
  blocked: "!",
  skipped: "–",
}

const fence = (source: string) => ["```mermaid", source.trim(), "```"].join("\n")

/** Markdown view of a plan: the tool result the model sees and what any client without the panel shows. */
export function planMarkdown(plan: Plan) {
  const lines = [`## ${plan.title} (v${plan.version})`, "", plan.summary.trim()]
  if (plan.diagram) lines.push("", fence(plan.diagram))
  if (plan.alternatives?.length) {
    lines.push("", "| Option | Pros | Cons | Chosen |", "| --- | --- | --- | --- |")
    for (const alt of plan.alternatives)
      lines.push(`| ${alt.name} | ${alt.pros.join("; ")} | ${alt.cons.join("; ")} | ${alt.chosen ? "✓" : ""} |`)
  }
  lines.push("")
  for (const step of plan.steps) {
    const files = step.files.length ? ` — ${step.files.join(", ")}` : ""
    lines.push(`${STATUS_ICON[step.status]} **${step.id}. ${step.title}** [${step.risk}]${files}`)
  }
  return lines.join("\n")
}

export function tallyLine(plan: Plan) {
  const counts = tally(plan)
  return [
    `${counts.approved}✓`,
    `${counts.rejected}✗`,
    `${counts.revise}✎`,
    counts.proposed ? `${counts.proposed}·` : "",
    counts.done ? `${counts.done}●` : "",
  ]
    .filter(Boolean)
    .join(" ")
}

const quote = (text: string) =>
  text
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")

/** The review as the model receives it, plus the one-line notice the timeline shows. */
export function reviewMessage(plan: Plan, input: Review) {
  const decisions = new Map(input.decisions.map((decision) => [decision.stepID, decision]))
  const lines = [
    `<plan-review version="${plan.version}" action="${input.action}">`,
    `The user reviewed plan v${plan.version} "${plan.title}".`,
    "",
  ]
  for (const step of plan.steps) {
    const decision = decisions.get(step.id)
    lines.push(`- ${step.id} "${step.title}": ${step.status}${decision?.edit ? " (edited by the user)" : ""}`)
    if (decision?.comment) lines.push(quote(decision.comment))
  }
  if (input.note) lines.push("", "General feedback:", quote(input.note))
  lines.push(
    "",
    input.action === "revise"
      ? "Revise the plan: address every comment and every step marked revise or rejected, keep ids of steps you keep, then call plan_propose again. Ask with plan_ask only if something is genuinely ambiguous."
      : "The user approved execution. The build agent runs only the approved steps.",
    "</plan-review>",
  )
  return {
    text: lines.join("\n"),
    description: `Plan review v${plan.version}: ${tallyLine(plan)}${input.action === "execute" ? " → execute" : " → revise"}`,
  }
}

/** Instructions for the build agent, re-sent every request while the plan executes. */
export function buildReminder(plan: Plan) {
  const approved = approvedSteps(plan)
  const lines = [
    "<approved-plan>",
    `Execute plan v${plan.version} "${plan.title}". Work ONLY on these approved steps, in dependency order:`,
  ]
  for (const step of approved) {
    lines.push(
      `- ${step.id} [${step.status}] ${step.title}${step.files.length ? ` (files: ${step.files.join(", ")})` : ""}`,
      `  ${step.detail.trim().replaceAll("\n", "\n  ")}`,
    )
  }
  const skipped = plan.steps.filter((step) => !approved.includes(step))
  if (skipped.length) lines.push(`Do NOT implement: ${skipped.map((step) => `${step.id} ${step.title}`).join("; ")}.`)
  lines.push(
    "Call plan_step with in_progress before starting a step and done when it is finished; use blocked with a note if you cannot finish it.",
    "</approved-plan>",
  )
  return lines.join("\n")
}

export function answersMessage(questions: Questions, input: Answers) {
  const lines = ["<plan-answers>", "The user answered your questions:"]
  for (const question of questions.questions) {
    const values = input.answers[question.id] ?? []
    const labels = values.map((value) => question.options?.find((option) => option.value === value)?.label ?? value)
    lines.push(`- ${question.question}`, `  → ${labels.length ? labels.join(", ") : "(no answer)"}`)
  }
  lines.push("Continue planning with these answers, then call plan_propose.", "</plan-answers>")
  return { text: lines.join("\n"), description: `Answered ${questions.questions.length} question(s)` }
}
