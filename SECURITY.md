# Security policy

## Reporting a vulnerability

Report it privately through [GitHub's private vulnerability reporting](https://github.com/smykla-skalski/opencode-plugin-plan-review/security/advisories/new). Do not open a public issue or pull request. Include the plugin version, the opencode version and the steps to reproduce.

## Supported versions

The latest release. The package is pre-1.0 and has no maintained release branches.

## What is worth reporting

- The architect agent editing files, or running tools that change the workspace.
- The build agent editing a file outside the approved steps without asking, while `gate` is `ask` or `deny`.
- A plan, review or answer from one session reaching another session.
- Plan text from the model that makes the plugin do anything other than store and display it.
