import { approvedSteps, byRisk, drift, tally } from "./plan.ts"
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

export const CHECK_ICON = { pass: "✓", fail: "✗", none: "○" } as const

const NOT_APPROVED: ReadonlySet<Step["status"]> = new Set(["proposed", "rejected", "revise"])

const fence = (source: string) => ["```mermaid", source.trim(), "```"].join("\n")

/** Markdown view of a plan: the tool result the model sees and what any client without the panel shows. */
export function planMarkdown(plan: Plan) {
  const lines = [`## ${plan.title} (v${plan.version})`, "", plan.summary.trim()]
  if (plan.diagram) lines.push("", fence(plan.diagram))
  if (plan.sequence) lines.push("", fence(plan.sequence))
  if (plan.alternatives?.length) {
    lines.push("", "| Option | Pros | Cons | Chosen |", "| --- | --- | --- | --- |")
    for (const alt of plan.alternatives)
      lines.push(`| ${alt.name} | ${alt.pros.join("; ")} | ${alt.cons.join("; ")} | ${alt.chosen ? "✓" : ""} |`)
  }
  lines.push("")
  for (const step of plan.steps) {
    const files = step.files.length ? ` — ${step.files.join(", ")}` : ""
    lines.push(`${STATUS_ICON[step.status]} **${step.id}. ${step.title}** [${step.risk}]${files}`)
    if (step.needsYou) lines.push(`  ⚑ ${step.needsYou}`)
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
    counts.in_progress ? `${counts.in_progress}▶` : "",
    counts.done ? `${counts.done}●` : "",
    counts.blocked ? `${counts.blocked}!` : "",
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

function nextInstruction(plan: Plan, action: Review["action"]) {
  if (action === "execute")
    return plan.reviewReason === "plan"
      ? "The user approved execution. Only the approved steps run."
      : "The user approved continuing. Carry on with the remaining approved steps."
  if (plan.reviewReason === "plan")
    return "Revise the plan: address every comment and every step marked revise or rejected, keep ids of steps you keep, then call plan_propose again. Ask with plan_ask only if something is genuinely ambiguous."
  return "Adjust the remaining work to the comments: call plan_propose with the full updated plan, keeping the ids, titles, details and files of steps you keep unchanged so finished steps stay finished and their results carry over. Then end your turn."
}

/** The review as the model receives it, plus the one-line notice the timeline shows. */
export function reviewMessage(plan: Plan, input: Review) {
  const decisions = new Map(input.decisions.map((decision) => [decision.stepID, decision]))
  const lines = [
    `<plan-review version="${plan.version}" reason="${plan.reviewReason}" action="${input.action}">`,
    `The user reviewed plan v${plan.version} "${plan.title}".`,
    "",
  ]
  for (const step of plan.steps) {
    const decision = decisions.get(step.id)
    lines.push(`- ${step.id} "${step.title}": ${step.status}${decision?.edit ? " (edited by the user)" : ""}`)
    if (decision?.comment) lines.push(quote(decision.comment))
  }
  if (input.note) lines.push("", "General feedback:", quote(input.note))
  lines.push("", nextInstruction(plan, input.action), "</plan-review>")
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
    const failed = step.check?.outcome === "fail" ? `, check failed: ${step.check.summary}` : ""
    lines.push(
      `- ${step.id} [${step.status}${failed}] ${step.title}${step.files.length ? ` (files: ${step.files.join(", ")})` : ""}`,
      `  ${step.detail.trim().replaceAll("\n", "\n  ")}`,
    )
  }
  const excluded = plan.steps.filter((step) => NOT_APPROVED.has(step.status))
  if (excluded.length) lines.push(`Do NOT implement: ${excluded.map((step) => `${step.id} ${step.title}`).join("; ")}.`)
  lines.push(
    "Loop per step: plan_step in_progress → implement → verify (run the relevant test, build or check) → plan_step done with check {outcome, summary, command}. Use blocked with a note if you cannot finish.",
    "If you find work the plan does not cover, call plan_amend instead of doing it silently. When a tool result says the plan is paused, end your turn.",
    "</approved-plan>",
  )
  return lines.join("\n")
}

/** What changed and why, riskiest first, with drift from the plan called out. The human's catch-up view. */
export function digestMarkdown(plan: Plan, directory: string) {
  const worked = byRisk(plan.steps.filter((step) => !NOT_APPROVED.has(step.status)))
  const lines = [`## What changed: ${plan.title} (v${plan.version})`, "", tallyLine(plan), ""]
  for (const step of worked) {
    const check = step.check ? ` ${CHECK_ICON[step.check.outcome]} ${step.check.summary}` : ""
    lines.push(`${STATUS_ICON[step.status]} **${step.id}. ${step.title}** [${step.risk}]${check}`)
    if (step.touched.length) lines.push(`  files: ${step.touched.join(", ")}`)
    const off = drift(step, directory)
    if (off.length) lines.push(`  ⚠ outside the step's plan: ${off.join(", ")}`)
    if (step.note) lines.push(`  note: ${step.note}`)
  }
  if (plan.outside.length) lines.push("", `⚠ Edited with no step in progress: ${plan.outside.join(", ")}`)
  const dropped = plan.steps.filter((step) => NOT_APPROVED.has(step.status))
  if (dropped.length) lines.push("", `Not done: ${dropped.map((step) => `${step.id} ${step.title}`).join("; ")}`)
  return lines.join("\n")
}

export function answersMessage(questions: Questions, input: Answers) {
  const lines = ["<plan-answers>", "The user answered your questions:"]
  for (const question of questions.questions) {
    const values = input.answers[question.id] ?? []
    const labels = values.map((value) => question.options?.find((option) => option.value === value)?.label ?? value)
    lines.push(`- ${question.question}`, `  → ${labels.length ? labels.join(", ") : "(no answer)"}`)
  }
  lines.push("Continue with these answers.", "</plan-answers>")
  return { text: lines.join("\n"), description: `Answered ${questions.questions.length} question(s)` }
}
