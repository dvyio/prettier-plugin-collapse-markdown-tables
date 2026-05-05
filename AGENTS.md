# AGENTS.md

## Project Shape

This package is an ESM-only Prettier plugin that rewrites Markdown table output after Prettier has printed Markdown, MDX, or remark input.

Built with TypeScript, Prettier, Vitest, esbuild, ESLint, Knip, and Husky. Check `package.json` for exact versions and current scripts.

## Core Rules

- Keep the plugin as a thin wrapper around Prettier's built-in Markdown printer. It should rewrite the final Markdown text, not replace Prettier's parser or invent a separate Markdown formatter.
- Plugin ordering matters. Put this plugin after other Markdown printer plugins when table collapsing must run.
- Keep the public package shape narrow: root ESM export only unless the release goal changes.
- Treat public helper input and Prettier options as untrusted. Validate them before normalizing.
- Preserve user text unless there is clear evidence that a row is a safe Markdown table row. Ambiguous or malformed rows should stay unchanged.
- Keep direct helper behavior and plugin behavior distinct. `normalizeMarkdownTables` does not run Prettier first, so bare GFM tables stay unchanged there.
- Keep this package ESM-only. Do not add a CommonJS build or direct `require()` support unless the release goal changes.

## Markdown Table Behavior

- Default table output is `spaced`. `compact` removes cell padding. `prettier` returns Prettier's aligned output unchanged.
- Preserve alignment markers, empty cells, missing trailing cells, list and blockquote prefixes, and existing line ending style.
- Row repair needs evidence. Merge split fragments only for open code spans or odd escaped pipes.
- Rows with extra real cells must stay unchanged. Do not silently change the cell count.
- Protected regions must stay untouched: fenced code, indented code, front matter, HTML comments, raw HTML blocks, Prettier ignore ranges, MDX JSX, and MDX ESM.
- Range formatting must only rewrite tables that intersect the requested range. Keep `rangeStart`, `rangeEnd`, and `cursorOffset` attached to the same logical text after table padding changes.

## Source Conventions

- Add `@fileoverview` to source and config files you create or substantially change. Keep it as the first doc comment.
- Public exports need short JSDoc that says what the function or type is for.
- Prefer small, focused modules under the normalizer. Split only when a rule has a clear boundary, such as protected regions, row parsing, repair, rendering, or line/range helpers.
- Keep imports and object/type keys sorted the way ESLint expects. Let the fixer do mechanical sorting.
- Use type imports for types. Keep arrays readonly where callers should not mutate them.
- Throw `Error` with a clear message at boundaries. Do not log from normalizer code.

## Tests

- Test names use the BDD style already in the suite: `given ..., when ..., then ...`.
- Bug fixes need a failing regression test first.
- Prefer behavior tests over implementation tests. If the same input and output would still pass after a rewrite, the test is probably at the right level.
- Use direct helper tests for row parsing, protected regions, malformed rows, code spans, escaped pipes, CRLF/CR-only input, range limits, and performance limits.
- Use Prettier API and CLI tests for plugin loading, parser wrapping, Markdown/MDX/remark behavior, style options, range formatting, cursor offsets, fixtures, snapshots, and package compatibility.
- Use the audit checklist before changing parser wrapping, range handling, protected-region scanning, table repair, rendering, packaging, or fixture coverage.
- Keep stress-only performance assertions behind `NORMALIZE_MARKDOWN_TABLES_STRESS=1`. Normal checks should catch hangs without failing on benchmark noise.

## Formatting And Dogfood

- `npm run format` and `npm run format:fix` use the repo Prettier config without this plugin. That keeps source formatting independent from the built package. README, CONTRIBUTING, SECURITY, and dogfood Markdown are checked by the dogfood scripts instead.
- `npm run format:dogfood:check` builds the plugin, then checks README, CONTRIBUTING, SECURITY, and dogfood Markdown with the built plugin.
- If README, CONTRIBUTING, SECURITY, or dogfood table output can change, run `npm run format:dogfood:fix` after the source change builds.
- Do not hand-edit `dist`. Change source files and run the build.
- Do not store generated filemap output in AGENTS.md. Run `filemap` in the terminal when you need a current overview.

## Workflow

- Before code changes, read the target file and the closest test file. For exported behavior, also search for callers and CLI/API coverage.
- For parser wrapping, range handling, protected regions, table repair, rendering, or package shape, read the matching section in `docs/audit-checklist.md` before editing.
- Run the narrow relevant test early, then run the full gate before done.
- Final TypeScript gate: `npm run lint:fix && npm run format:fix && npm run check`.
- For Markdown table behavior changes, run `npm run format:dogfood:fix` before the final gate.
- Release or package-shape changes also need `npm run pack:check`.
- Run `npm run test:stress` when performance-sensitive scanning, cursor mapping, or adversarial table handling changes.

## Git Hygiene

- The worktree may contain unrelated local edits. Do not clean, reset, or rewrite files outside the task.
- Keep generated audit reports and other untracked notes out of unrelated changes unless the task asks for them.
- `CLAUDE.md` should be a symlink to this file.
