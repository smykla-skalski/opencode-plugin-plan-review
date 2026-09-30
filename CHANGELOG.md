# Changelog

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
