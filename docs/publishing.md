# Publishing to npm

The npm organization `smykla-skalski` owns `@smykla-skalski/opencode-plugin-plan-review`. Version `0.1.0` was published with an npm account, because npm attaches a trusted publisher only to a package that already exists. Later versions use the GitHub Actions trusted publisher connected to `smykla-skalski/opencode-plugin-plan-review`, `publish.yml`, and the `npm` environment with direct publish permission. The workflow follows the [organization catalog](https://github.com/smykla-skalski/.github/tree/main/sync).

## Release

1. Bump the version in `package.json` and `package-lock.json` (`npm version <x.y.z> --no-git-tag-version`), and update `CHANGELOG.md`.
2. Merge that signed commit to `main` through a PR and wait for CI.
3. Create a GitHub Release from that commit with tag `v<package version>`.
4. The `Publish` workflow checks the tag matches the version and is on `main`, runs `mise run check`, and skips prereleases. It publishes with OIDC only when the repository variable `NPM_PUBLISH_ENABLED` is `true`; otherwise it runs `npm publish --dry-run`.
5. Verify with `npm view @smykla-skalski/opencode-plugin-plan-review version` and check the provenance badge on npm.

Do not reuse a version already published to npm, even if it was unpublished.

## Trusted publisher settings

| Field                | Value                          |
| -------------------- | ------------------------------ |
| Organization or user | `smykla-skalski`               |
| Repository           | `opencode-plugin-plan-review`  |
| Workflow filename    | `publish.yml`                  |
| Environment          | `npm`                          |
| Allowed actions      | Direct `npm publish`           |

Replace the current no-environment trusted publisher with one for `--env npm`, using `npm trust list`, `npm trust revoke`, and `npm trust github @smykla-skalski/opencode-plugin-plan-review --file publish.yml --repo smykla-skalski/opencode-plugin-plan-review --env npm --allow-publish`. Set `NPM_PUBLISH_ENABLED=true` after the new publisher is active. The workflow uses GitHub's OIDC identity, so it needs no npm token or repository secret, and npm generates provenance automatically for this public repository.

Sources: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/), [npm trust CLI](https://docs.npmjs.com/cli/v11/commands/npm-trust/), [npm provenance](https://docs.npmjs.com/generating-provenance-statements/).
