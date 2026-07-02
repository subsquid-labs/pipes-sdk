---
name: deploy-pipes-cli
description: Deploy a new version of @subsquid/pipes-cli to npm. Handles version bumping, building, testing, publishing, and git tagging. Use when user says "deploy", "release", "publish", or "bump version" for the pipes CLI package.
---

# Deploy Pipes CLI

Publish a new version of `@subsquid/pipes-cli` to the npm registry.

## Pre-flight checks

Before starting, verify:

- [ ] Working tree is clean (`git status` shows no uncommitted changes)
- [ ] You are on the correct branch (typically `design/sdk1` or `main`)
- [ ] npm auth is valid (`pnpm whoami`)

If any check fails, stop and tell the user.

## Deployment workflow

### 1. Determine the new version

Current version lives in `packages/pipes-cli/package.json` under `"version"`.
The project uses **pre-release semver**: `1.0.0-alpha.N`.

Ask the user which bump they want:

| Bump type | Example |
|-----------|---------|
| Pre-release (default) | `1.0.0-alpha.1` -> `1.0.0-alpha.2` |
| Minor | `1.0.0-alpha.1` -> `1.1.0` |
| Major | `1.0.0-alpha.1` -> `2.0.0` |
| Custom | User specifies exact version |

### 2. Run tests

```bash
pnpm --filter @subsquid/pipes-cli run test
```

If tests fail, stop and report failures. Do not publish broken code.

### 3. Run the build

```bash
pnpm --filter @subsquid/pipes-cli build
```

The CLI build:
- Produces `dist/index.cjs` (CJS binary with shebang)
- Produces ESM/CJS config exports with `.d.ts` declarations
- Copies template files to `dist/template/`

If the build fails (especially DTS generation), stop and report.

### 4. Bump the version

Edit `packages/pipes-cli/package.json` to set the new version string.

### 5. Commit the version bump

```bash
git add packages/pipes-cli/package.json
git commit -m "chore(pipes-cli): bump version to <NEW_VERSION>"
```

### 6. Tag the release

```bash
git tag pipes-cli-v<NEW_VERSION>
```

### 7. Verify the tarball (MANDATORY)

Before publishing, pack and inspect the tarball to confirm that the `workspace:` protocol has been rewritten to concrete versions. If `workspace:*` leaks into the published tarball, consumers get `EUNSUPPORTEDPROTOCOL` on install.

```bash
rm -rf /tmp/pipes-cli-verify && mkdir -p /tmp/pipes-cli-verify
pnpm --filter @subsquid/pipes-cli pack --pack-destination /tmp/pipes-cli-verify
tar -xzf /tmp/pipes-cli-verify/*.tgz -C /tmp/pipes-cli-verify
grep -n 'workspace:' /tmp/pipes-cli-verify/package/package.json && echo "FAIL: workspace: protocol leaked" && exit 1
```

If the `grep` finds anything, stop. The publish tool is not rewriting the workspace protocol — do NOT fall back to `npm publish` (it does not rewrite `workspace:` at all; that is how `1.0.0-alpha.1` shipped broken).

### 8. Publish to npm

Publish the **verified tarball** directly (not a fresh pack) so you publish exactly what you inspected:

```bash
pnpm publish /tmp/pipes-cli-verify/*.tgz --access public
```

Never use `npm publish` for this package — it does not rewrite the `workspace:` protocol and will produce a broken release.

The `files` field in package.json controls what gets included in the tarball: `dist/`, `src/`, `package.json`, `README.md`, `LICENSE`.

### 9. Push commit and tag

Ask the user before pushing:

```bash
git push origin <current-branch>
git push origin pipes-cli-v<NEW_VERSION>
```

### 10. Verify

```bash
pnpm info @subsquid/pipes-cli version
```

Confirm the published version matches the intended release.

## Rollback

If a bad version was published:

```bash
pnpm unpublish @subsquid/pipes-cli@<BAD_VERSION>
git tag -d pipes-cli-v<BAD_VERSION>
git push origin :refs/tags/pipes-cli-v<BAD_VERSION>
```

Note: `pnpm unpublish` only works within 72 hours of publish. After that, use `pnpm deprecate` instead.

## Notes

- The package is scoped to `@subsquid` and published to the default npm registry (npmjs.org)
- The binary name is `pipes` (users run `npx @subsquid/pipes-cli` or install globally)
- There is a workspace dependency `@subsquid/pipes: workspace:*` -- if that package also changed, it may need publishing first
- No automated CI/CD publish workflow exists; this is a manual process
