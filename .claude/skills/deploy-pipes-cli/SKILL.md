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

Current version lives in `packages/cli/package.json` under `"version"`.
The project uses **pre-release semver**: `0.1.0-beta.N`.

Ask the user which bump they want:

| Bump type | Example |
|-----------|---------|
| Pre-release (default) | `0.1.0-beta.22` -> `0.1.0-beta.23` |
| Minor | `0.1.0-beta.22` -> `0.2.0` |
| Major | `0.1.0-beta.22` -> `1.0.0` |
| Custom | User specifies exact version |

### 2. Run tests

```bash
cd packages/cli && pnpm run test
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

Edit `packages/cli/package.json` to set the new version string.

### 5. Commit the version bump

```bash
git add packages/cli/package.json
git commit -m "chore(cli): bump version to <NEW_VERSION>"
```

### 6. Tag the release

```bash
git tag cli-v<NEW_VERSION>
```

### 7. Publish to npm

```bash
pnpm --filter @subsquid/pipes-cli publish --access public
```

The `files` field in package.json controls what gets published: `dist/`, `src/`, `package.json`, `README.md`, `LICENSE`.

### 8. Push commit and tag

Ask the user before pushing:

```bash
git push origin <current-branch>
git push origin cli-v<NEW_VERSION>
```

### 9. Verify

```bash
pnpm info @subsquid/pipes-cli version
```

Confirm the published version matches the intended release.

## Rollback

If a bad version was published:

```bash
pnpm unpublish @subsquid/pipes-cli@<BAD_VERSION>
git tag -d cli-v<BAD_VERSION>
git push origin :refs/tags/cli-v<BAD_VERSION>
```

Note: `pnpm unpublish` only works within 72 hours of publish. After that, use `pnpm deprecate` instead.

## Notes

- The package is scoped to `@subsquid` and published to the default npm registry (npmjs.org)
- The binary name is `pipes` (users run `npx @subsquid/pipes-cli` or install globally)
- There is a workspace dependency `@subsquid/pipes: workspace:*` -- if that package also changed, it may need publishing first
- No automated CI/CD publish workflow exists; this is a manual process
