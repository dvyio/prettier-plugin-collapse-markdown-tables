# Audit Coverage Checklist

Use this checklist when changing the plugin, adding a formatter option, or fixing a table parsing bug. Each change should either add or update the matching regression tests, or state why the area is not affected.

Use this with [the contributor workflow](../CONTRIBUTING.md). The checklist names the risky areas. The contributor workflow says which focused tests, stress tests, dogfood checks, and release checks to run.

Release steps live in [the release runbook](release-runbook.md).

## Plugin Integration

Files:

- `src/index.ts`
- `tests/prettierPlugin.test.ts`
- `package.json`
- `tsconfig.json`
- `tsconfig.test.json`
- `.prettierignore`
- `.prettierignore.dogfood`
- `README.md`

Checklist:

- Parser wrapping keeps Prettier's original `rangeStart`, `rangeEnd`, and `cursorOffset` attached to the same logical text after preprocessing.
- Root printer rewriting only changes requested ranges during range formatting.
- Doc conversion with `printDocToString` does not place embedded newlines inside Prettier doc strings.
- Markdown, MDX, and remark parsers all keep the same table output rules.
- The CLI path, package smoke test, and peer Prettier versions still load the built plugin.
- Dogfood formatting checks this README, `CONTRIBUTING.md`, `SECURITY.md`, and `tests/dogfood/markdown-tables.md` with the built plugin.

## Table Normalization

Files:

- `src/normalizeMarkdownTables.ts`
- `src/normalizer/lineUtils.ts`
- `src/normalizer/options.ts`
- `src/normalizer/protectedRegions.ts`
- `src/normalizer/mdxEsm.ts`
- `src/normalizer/mdxJsx.ts`
- `src/normalizer/htmlBlocks.ts`
- `src/normalizer/tableRows.ts`
- `src/normalizer/tableRepair.ts`
- `src/normalizer/tableRender.ts`
- `tests/normalizeMarkdownTables.test.ts`
- `tests/tableRows.test.ts`
- `tests/fixtures/markdown-contexts.md`
- `tests/fixtures/mdx-contexts.mdx`
- `tests/fixtures/malformed-tables.md`
- `tests/fixtures/protected-regions.md`
- `tests/fixtures/helper-semantics.md`
- `tests/__snapshots__/prettierPlugin.test.ts.snap`

Checklist:

- Table detection still requires safe pipe-wrapped rows and valid delimiter rows.
- Range handling normalizes only tables that intersect the requested range.
- Protected-region scanning still skips front matter, protected code fences, indented code, comments, HTML blocks, raw HTML, MDX JSX, MDX ESM, and Prettier ignore ranges.
- Row parsing keeps list and blockquote prefixes stable.
- Code spans follow CommonMark rules: matching delimiter-run length, literal backslashes inside spans, escaped opening backticks only with odd backslashes, and unmatched spans marked unsafe.
- Escaped pipes use odd/even backslash counts in cell scanning, row repair, and rendering.
- Malformed-row repair only merges fragments when there is repair evidence: an open code span or an odd escaped pipe.
- Rows with extra real cells stay unchanged so table cell counts do not change silently.
- Rendering keeps alignment markers, empty cells, missing trailing cells, and compact/spaced styles stable.
- CRLF input keeps CRLF output.

## Regression Tests

Files:

- `tests/normalizeMarkdownTables.test.ts`
- `tests/tableRows.test.ts`
- `tests/prettierPlugin.test.ts`
- `tests/fixtures/*`
- `tests/__snapshots__/*`

Checklist:

- Helper tests cover direct `normalizeMarkdownTables` behavior, row parsing, protected regions, malformed rows, code spans, escaped pipes, repair, compact style, CRLF, and range limits.
- Prettier API tests cover `format`, `formatWithCursor`, Markdown, MDX, remark, default style, explicit style values, `prettier` style, range formatting, cursor offsets, fixtures, and snapshots.
- CLI tests cover `--check`, `--write`, `--debug-check`, plugin load errors, ignored tables, and packed package compatibility.
- Fixture snapshots prove formatted output stays stable after a second formatting pass.
- Semantic table tests compare plugin output with built-in Prettier for cell content, not just string shape.

## Performance And Safety

Files:

- `src/normalizeMarkdownTables.ts`
- `src/normalizer/*`
- `tests/normalizeMarkdownTables.test.ts`

Checklist:

- Pipe-heavy rows and large files without pipes stay linear enough for normal editor use.
- Adversarial rows with many pipes, escapes, or unmatched code spans preserve input instead of guessing.
- Direct helper calls do not rewrite bare GFM tables before Prettier has converted them to pipe-wrapped rows.
- Error paths fail loudly with clear messages when invalid range offsets are passed.
