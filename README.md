# opencode-plugin-plan-review

An [opencode](https://github.com/anomalyco/opencode) v2 plugin that turns the plan stage into a structured plan you review step by step in the terminal, instead of a wall of markdown in the chat.

- The **architect** agent researches the code, asks all its clarifying questions at once in a single form, and submits a plan made of steps with ids, detail, rationale, files, risk, dependencies, optional mermaid diagrams and a table of the alternatives it considered.
- A **review panel** opens next to the session. You approve, reject, ask to revise, edit or comment on each step, add general feedback, then either send the review back (the agent revises, and approved steps stay approved) or execute.
- **Execute** switches to the build agent with only the approved steps. The build agent reports progress per step, and an edit to a file no approved step lists asks you first.

Status: draft. It targets the opencode v2 plugin API, which is still pre-stable.

## Install

The plugin ships a server entry and a TUI entry in one package; opencode loads the TUI half of every active server plugin on its own.

```jsonc
// opencode.jsonc
{
  "plugins": ["@smykla-skalski/opencode-plugin-plan-review"]
}
```

For local development, point `plugins` at a checkout: `"plugins": ["/path/to/opencode-plugin-plan-review"]`. opencode watches the files and reloads the plugin when they change.

## Use

1. Switch to the **Architect** agent and describe the change.
2. If it needs answers, the panel shows every question as one form. Answer and press `ctrl+s`.
3. When the plan arrives, the panel opens. Review it with the keys below.
4. Press `s` to send the review for another round, or `x` to execute the approved steps.

`/plan` or `<leader>p` reopens the panel. The line above the prompt shows the plan version and a tally, and the sidebar shows an outline.

| Key | Plan panel | Questions form |
| --- | --- | --- |
| `j` / `k` | next / previous step | next / previous option |
| `a` / `r` / `v` | approve / reject / ask to revise the step | |
| `e` | edit the step (counts as approved) | |
| `c` | comment on the step | |
| `A` | approve every undecided step | |
| `n` | general feedback | |
| `s` / `x` | send review (revise) / execute approved steps | |
| `tab` / `shift+tab` | | next / previous question |
| `space`, `enter` | | select option, type a text answer |
| `ctrl+s` | | send answers |
| `o` / `f` / `q` | toggle summary / fullscreen / close | fullscreen / close |

Review drafts are saved on disk, so a half-finished review survives a restart.

## Options

```jsonc
{
  "plugins": [
    {
      "package": "@smykla-skalski/opencode-plugin-plan-review",
      "options": {
        "agent": "architect",
        "buildAgent": "build",
        "gate": "ask"
      }
    }
  ]
}
```

| Option | Default | What it does |
| --- | --- | --- |
| `agent` | `architect` | Id of the planning agent the plugin defines. |
| `buildAgent` | `build` | Agent that executes approved steps. |
| `gate` | `ask` | What happens when the build agent edits a file no approved step lists: `ask`, `deny`, or `off`. |

## How it works

```text
architect ──plan_ask──────► questions stored ──► form in panel ──ctrl+s──► <plan-answers> wakes the agent
architect ──plan_propose──► plan vN stored ────► review panel ──s──► <plan-review action=revise> ──► plan vN+1
                                                              └──x──► switch to build + <plan-review action=execute>
build ──plan_step──► per-step progress; context hook re-sends the approved steps every request; edit gate asks outside them
```

- The tools return immediately and the agent ends its turn, so nothing waits in memory: plans, questions and drafts live in plugin storage and survive restarts.
- The review reaches the model as a synthetic message; the timeline shows a one-line notice such as `Plan review v2: 5✓ 1✗ 2✎ → revise`.
- The architect does not get opencode's one-question-at-a-time `question` tool, and only the architect gets `plan_propose` and `plan_ask`.

## Known gaps

These need changes in opencode itself; the plugin works around them.

- **Mermaid inside the panel** shows as source. opencode renders mermaid in chat, but it does not expose its renderer to plugins.
- **No rich card in the timeline.** Tool calls without a built-in renderer show as one generic line; the panel and the line above the prompt carry the plan instead.
- **Shell commands are not gated** to the approved files; only edit, write and patch are.
- **Web and desktop apps** do not render the panel; they see the markdown plan in the tool output.

## Development

```sh
mise install
mise run install
mise run check   # typecheck, oxlint, markdownlint, actionlint + zizmor, tests, npm pack
```

The plan logic (`src/plan.ts`, `src/render.ts`, `src/gate.ts`, `src/tui/draft.ts`) is pure and unit tested; the server and TUI entries are thin wiring over the v2 plugin API.

## License

MIT
