# Changelog

## 0.2.0

- Every plan carries an overview flowchart and a sequence diagram; the agent adds state, class or ER diagrams when states, lifecycles or data shapes change.
- Diagrams render as text art in the panel, pan sideways with ←/→ when wider than the panel, and keep their boxes aligned.
- The panel stays open from the first question until the plan runs; `q` returns to the chat instead of closing it.
- The questions form moves one cursor through every option with the arrow keys; Enter accepts and moves on, and a Send row submits.
- The plan panel scrolls as one area (arrows past the first or last step, page keys, mouse wheel), labels its sections, lists alternatives with pros and cons, and shows every step with `⚑` on the ones needing a decision.
- Plan tools accept weaker tool-calling models: flat arguments, lists sent as JSON text, backtick-quoted values, and diagram bodies without a header.

## 0.1.3

- `plan_propose` takes the plan as one `plan` object, so the timeline shows a single `plan_propose` line instead of every text field in full.
- Proposing a plan clears questions still pending from earlier, so the panel shows the new plan instead of an obsolete form.

## 0.1.2

- Fix the TUI panel not loading when installed from npm: the JSX runtime is now declared per file instead of relying on the unshipped tsconfig.
- Expose the plan tools directly instead of through Code Mode, so calls render cleanly and per-agent tool hiding applies.

## 0.1.1

- First release published from CI through npm trusted publishing, with provenance.
- Update zod to 4.6.5.

## 0.1.0

- Structured plans reviewed step by step in a terminal panel: approve, reject, ask to revise, edit or comment per step, then revise or execute.
- The build agent decides when a task needs questions and a plan; the architect agent plans up front on request.
- Steps that need a human decision carry a one-line `⚑`; routine steps fold away.
- Clarifying questions arrive as one form with options and recommendations.
- Plans amend during execution; risky or new-file additions pause for review.
- Each finished step records its check and touched files; risky or failing steps pause at a checkpoint.
- A "what changed" digest lists results riskiest first, with drift from the plan.
