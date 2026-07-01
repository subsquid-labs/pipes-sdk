---
name: subsquid-pipes-release
description: Cut a new @subsquid/pipes release — bump the version, tag, push, watch the Release workflow, and publish GitHub release notes. Handles stable releases and alpha/beta/rc prereleases (published to matching npm dist-tags via Trusted Publishing). Use when the user asks to "release", "publish", "cut a version", "ship", or "cut an alpha/beta" for @subsquid/pipes.
---

# @subsquid/pipes release

End-to-end release procedure for **`@subsquid/pipes`** (the core SDK). Bumps `packages/subsquid-pipes/package.json`, tags `pipes-v<version>`, pushes, watches the `Release @subsquid/pipes` workflow ([release-subsquid-pipes.yml](../../../.github/workflows/release-subsquid-pipes.yml)), then rewrites the auto-generated GitHub release notes for stable releases.

Publishing runs on **npm Trusted Publishing** (OIDC + provenance, no `NPM_TOKEN`). The tagged commit is the source of truth: the workflow refuses to publish unless `package.json` already carries the version in the tag.

Supports **prereleases** (`1.0.0-alpha.14`, `1.0.0-beta.1`, `1.0.0-rc.1`) as well as stable versions. A prerelease publishes to a matching npm dist-tag (`@alpha`/`@beta`/`@rc`) instead of `@latest` and is flagged as a GitHub pre-release. See [Prereleases (alpha/beta)](#prereleases-alphabeta).

> **Scope:** this skill releases `@subsquid/pipes` only. `@subsquid/pipes-cli` has its own separate procedure — use the `deploy-pipes-cli` skill for that. Don't cross the two: they have different tag prefixes (`pipes-v*` vs `pipes-cli-v*`) and different publish mechanics.

## Preconditions

Confirm before starting:
- `git status` is clean on `main` (or the version bump is staged deliberately).
- The user named a target version, e.g. `1.0.0-alpha.14` (prerelease) or `1.0.0` (stable). If not, ask. See [Choosing the next version](#choosing-the-next-version).
- A **trusted publisher** for `@subsquid/pipes` is configured on npmjs.com pointing at `subsquid-labs/pipes-sdk` → `.github/workflows/release-subsquid-pipes.yml`. This is a one-time setup on npm (Package → Settings → Trusted Publishing). Without it, the `publish` job 404s. See [First-time setup](#first-time-setup-trusted-publishing).

## Steps

### 1. Bump the version

Set the target version in `packages/subsquid-pipes/package.json`.

The workflow's `Verify version` step compares the exact string — including any prerelease suffix — against the tag and refuses to publish on a mismatch. So `1.0.0-alpha.14` in the tag must equal `1.0.0-alpha.14` in `package.json`.

### 2. Commit and tag

```sh
git add packages/subsquid-pipes/package.json
git commit -m "chore(release): @subsquid/pipes <version>"
git tag pipes-v<version>
git push origin main
git push origin pipes-v<version>
```

Both pushes are required — the workflow triggers on `tags: ['pipes-v*']`. The tag prefix (`pipes-v`) is what scopes this release to the core package and keeps it distinct from `pipes-cli-v*`.

### 3. Watch the workflow

```sh
gh run watch --repo subsquid-labs/pipes-sdk --exit-status
```

Or list + tail the latest:

```sh
RUN_ID=$(gh run list --repo subsquid-labs/pipes-sdk --workflow=release-subsquid-pipes.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN_ID" --repo subsquid-labs/pipes-sdk --exit-status
```

Three jobs: `check` → `publish` → `github-release`. If `publish` fails on npm Trusted Publishing, the trusted publisher config on npmjs.com may be missing or misconfigured — surface the error to the user, don't retry blindly.

### 4. Rewrite release notes

**Stable releases only.** For a prerelease, skip this step — the workflow already flags it as a pre-release and its auto-generated notes stay as-is. See [Prereleases (alpha/beta)](#prereleases-alphabeta).

The `github-release` job creates the release with `generate_release_notes: true` (auto-generated bullet list). Replace it with the standardized format from [release-template.md](release-template.md).

Source the highlights from the commits since the previous release; pick the user-visible changes rather than restating every commit.

```sh
gh release edit pipes-v<version> --repo subsquid-labs/pipes-sdk --notes "$(cat <<'EOF'
...standardized notes...
EOF
)"
```

### 5. Confirm

Print the release URL and verify the dist-tag landed where you expect:

```sh
echo "https://github.com/subsquid-labs/pipes-sdk/releases/tag/pipes-v<version>"
npm view @subsquid/pipes dist-tags
```

## Prereleases (alpha/beta)

Cut a prerelease exactly like a stable release (steps 1–3), but name a prerelease version: `1.0.0-alpha.14`, `1.0.0-beta.1`, `1.0.0-rc.1`. Bump `package.json` to that string, tag `pipes-v1.0.0-alpha.14`, push. The workflow handles the rest — no extra inputs:

- **npm dist-tag** — the `Resolve npm dist-tag` step maps the identifier to a channel: `alpha` → `@alpha`, `beta` → `@beta`, `rc` → `@rc` (any other suffix → `@next`). Stable `X.Y.Z` stays on `@latest`. So a plain `npm i @subsquid/pipes` never serves a prerelease; testers opt in with `npm i @subsquid/pipes@alpha`. This matches the package's existing convention (alphas already live on the `alpha` dist-tag).
- **GitHub release** — the `github-release` job flags it `prerelease: true` and `make_latest: false`, so it stays out of the "Latest release" slot automatically. No manual step.

### Release notes for prereleases

Keep it light. **Do not** run the standardized template — leave the workflow's auto-generated notes in place. Optionally prepend a 1–2 sentence "what to test" lead so testers know where to focus:

```sh
BODY=$(gh release view pipes-v1.0.0-alpha.14 --repo subsquid-labs/pipes-sdk --json body --jq '.body')
gh release edit pipes-v1.0.0-alpha.14 --repo subsquid-labs/pipes-sdk --notes "$(cat <<EOF
Prerelease for testing <feature>. Install with \`npm i @subsquid/pipes@alpha\`. Please report issues against <area>.

$BODY
EOF
)"
```

Save the polished, sectioned notes (step 4 + [release-template.md](release-template.md)) for the stable release that follows.

## Choosing the next version

Numbering is manual (the user names the version). Check what's already published before picking one:

```sh
npm view @subsquid/pipes dist-tags
npm view @subsquid/pipes versions --json | tail -20
```

Increment within a channel: `1.0.0-alpha.14` → `1.0.0-alpha.15`. Move channels when stabilizing: `…-alpha.N` → `…-beta.1` → `…-rc.1` → `1.0.0` (drop the suffix for the stable cut). The first stable `1.0.0` will take over the `latest` dist-tag from the legacy `0.1.0-beta.17` currently sitting there.

## First-time setup (Trusted Publishing)

Publishing uses OIDC — there is no `NPM_TOKEN` secret. Once, before the first automated release, a maintainer with publish rights on `@subsquid/pipes` configures a trusted publisher on npmjs.com:

- Package → **Settings** → **Trusted Publishing** → add a GitHub Actions publisher.
- Repository: `subsquid-labs/pipes-sdk`
- Workflow filename: `release-subsquid-pipes.yml`

The workflow requests `id-token: write` and publishes with `--provenance`, so releases carry a verifiable provenance attestation. If this config is missing, the `Publish @subsquid/pipes` step fails with a 404/401 — that's the signal it hasn't been set up (or the repo/workflow name doesn't match).

## Failure modes

- **Tag exists**: `git tag pipes-v<version>` fails. Either the release was already started or a previous attempt didn't finish. Check `gh release view pipes-v<version>` and `gh run list --workflow=release-subsquid-pipes.yml`. Don't force-delete tags without confirming.
- **`Verify version` fails in CI**: `packages/subsquid-pipes/package.json` doesn't match the tag. Fix locally, commit, retag, repush. Don't reuse a tag that already published.
- **Publish fails on Trusted Publishing**: the trusted publisher for `@subsquid/pipes` is missing or points at the wrong repo/workflow. See [First-time setup](#first-time-setup-trusted-publishing). Don't fall back to a manual `npm publish` with a token unless the user explicitly asks — that bypasses provenance.
- **Prerelease served to a plain `npm i`**: shouldn't happen — the `Resolve npm dist-tag` step routes alpha/beta/rc off `latest`. If a tester reports a bare install pulling a prerelease, inspect the tags: `npm view @subsquid/pipes dist-tags`. `latest` must point at the newest *stable*; if it drifted, repoint it with `npm dist-tag add @subsquid/pipes@<stable> latest` (requires npm auth — this recovery is manual, outside the OIDC workflow).
- **Wrong package**: if the user meant the CLI (`@subsquid/pipes-cli`), stop and use the `deploy-pipes-cli` skill instead — different tag prefix and publish path.
