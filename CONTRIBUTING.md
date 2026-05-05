# Contributing

Thanks for helping improve `@dvyio/prettier-plugin-collapse-markdown-tables`.

This package is a Prettier plugin, so small parser or range bugs can change many files for users. Keep changes focused, add behavior tests, and run the checks that match the risk.

## Setup

Use Node `>=22.12`.

```bash
npm install
npm run build
```

Do not edit `dist` by hand. Source files build it.

## Fast Checks

Run the smallest useful check while you work:

| Change | Command |
| --- | --- |
| TypeScript source | `npm run typecheck` |
| One behavior test | `npx vitest run tests/normalizeMarkdownTables.test.ts -t "part of test name"` |
| Plugin behavior | `npx vitest run tests/prettierPlugin.test.ts -t "part of test name"` |
| Table row parsing | `npx vitest run tests/tableRows.test.ts` |
| Package shape | `npm run pack:check` |

Bug fixes need a regression test that fails before the fix.

## Before Opening A PR

Run the normal gate:

```bash
npm run check
```

Run the release gate when the change can affect publishing, parser wrapping, range formatting, cursor mapping, MDX scanning, protected regions, performance, or package metadata:

```bash
npm run check:release
```

`check:release` runs `check`, `test:stress`, `test:mutation`, and `pack:check`.

## Stress Tests

Run `npm run test:stress` when you touch:

- table scanning or rendering
- malformed table repair
- protected-region scanning
- MDX ESM or MDX JSX scanning
- range or cursor offset mapping
- performance-sensitive loops

Normal tests should prove behavior. Stress tests should catch hangs and major slowdowns.

## Dogfood Checks

`npm run format` uses the repo Prettier config without this plugin. README, CONTRIBUTING, SECURITY, and dogfood Markdown are checked by the dogfood scripts instead.

`npm run format:dogfood:check` builds the plugin, then checks `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `tests/dogfood/markdown-tables.md` with the built plugin.

Run `npm run format:dogfood:fix` when README, contributing, security, or dogfood Markdown table output should change.

## Fixtures And Snapshots

Use fixtures when a behavior needs realistic Markdown, MDX, CLI, or package coverage.

Update fixtures or snapshots only when the user-visible output is meant to change. Keep fixture changes small enough that a reviewer can see the behavior being tested.

Use `docs/audit-checklist.md` before changing parser wrapping, range handling, protected-region scanning, table repair, rendering, packaging, or fixture coverage.

## PR Expectations

In the PR description, include:

- what changed
- which user-visible behavior changed
- which focused tests you ran
- whether `npm run check` or `npm run check:release` passed
- why any skipped check was safe to skip

Keep dependency updates separate from behavior changes unless the dependency update is needed for the fix.
