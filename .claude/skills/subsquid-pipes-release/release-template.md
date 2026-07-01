# Release notes template

For **stable** `@subsquid/pipes` releases. Prereleases keep the workflow's auto-generated notes — see the "Prereleases" section in [SKILL.md](SKILL.md).

Two shapes — pick by version delta.

## Patch release (X.Y.Z → X.Y.Z+1)

Flat bullet list, no area sections.

```markdown
## <Headline>

<1-2 sentence lead — what the user notices.>

- Bullet 1
- Bullet 2
- Bullet 3

**Full Changelog**: https://github.com/subsquid-labs/pipes-sdk/compare/<PREV_TAG>...pipes-v<NEW>
```

## Minor / major release (X.Y.Z → X.Y+1.0 or X+1.0.0)

Sectioned. Use only the sections that apply — `@subsquid/pipes` ships across several surfaces, so group by the ones that changed.

```markdown
## <Headline>

<1-3 sentence lead — what changed for the user, not the implementation.>

### Highlights
- **Bold lede** — short explanation.
- **Bold lede** — short explanation.

### Core
- Stream/pipeline behavior, forks, watermarks, cursor handling.

### Targets
- ClickHouse / Postgres (Drizzle) / Parquet / BigQuery changes. Name the target.

### Portal client
- Query, caching, or portal-client API changes.

### Chains
- EVM / Solana / Hyperliquid / Bitcoin decoder or helper changes.

### API
- `<new export or option>` — short description.
- Breaking: `<what changed>` — migration note.

**Full Changelog**: https://github.com/subsquid-labs/pipes-sdk/compare/<PREV_TAG>...pipes-v<NEW>
```

## Style rules

- **No emoji** — neither in the title nor in section headers or bullets.
- **No version in the title** — GitHub renders the tag separately.
- **Lead with user-visible impact**, not internal mechanism.
- **Bold the lede of each highlight bullet** so the page scans in 5 seconds.
- **Don't restate the commit message verbatim.** The commit body is the engineer's view; release notes are the user's.
- **Call out breaking changes explicitly** with a migration note — this is a `1.0.0`-track library and consumers pin on it.
- **Skip "Tests" / internal-only churn** unless the headline is *about* it.
- **End with the compare link.** Resolve `<PREV_TAG>` as the previous `pipes-v*` tag if one exists, otherwise the parent commit SHA: `git rev-parse pipes-v<NEW>^ | cut -c1-7`. Don't blindly write a `pipes-v*` tag that may not exist — early releases predate the tag scheme and the link would 404.
- **No install block.** Install instructions live in the README. Release notes are for *what changed*.
