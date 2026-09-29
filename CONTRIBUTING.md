# Contributing

1. `mise install && mise run install`
2. Make the change. Keep logic in the pure modules under `src/` and cover it in `test/`; keep `src/server.ts` and the TUI components as wiring.
3. `mise run check` must pass.
4. Commit with a conventional message that has a scope, for example `feat(tui): add step filter`, signed off and signed (`git commit -s -S`).
5. Open a pull request using the template.

To try the plugin, add the checkout's absolute path to `plugins` in a project's `opencode.jsonc` and start opencode there.
