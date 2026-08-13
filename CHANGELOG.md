# Changelog

All public release notes for `@dvyio/prettier-plugin-collapse-markdown-tables` live here.

## Release Policy

This package follows semver for published releases:

- Patch releases fix bugs, improve docs, or reduce runtime cost without changing the public contract.
- Minor releases add options, expand supported syntax, or change parser behaviour in ways that can change formatted output.
- Major releases remove or rename public options, change the default table style, change the module contract, or change the supported Node or Prettier major version.

While the package is still below `1.0.0`, breaking changes will be called out clearly and will use at least a minor version bump.

The supported Prettier line is Prettier `3.x`. The test suite checks the packed package with Prettier `3.0.0` and the current Prettier `3.x` version used by this repo.

Parser-behaviour changes need a changelog entry when they affect which table-shaped text is rewritten, which regions are protected, or how range and cursor offsets map after formatting. If a change can alter a user's Markdown output, it belongs here.

## 0.2.1 - 2026-08-13

### Fixed

- Kept pipes inside closed inline-code spans in the intended table cell across Markdown, MDX, and remark tables, including tables with optional outer pipes.
- Restored delimiters widened by an earlier Prettier run when inline-code pipes account for every extra column.
- Kept range selections and cursor positions attached to the correct text after table preprocessing and normal Prettier wrapping.
- Stopped table preprocessing at headings and fresh list items, and kept ignored blockquote tables untouched.
- Reduced memory use when scanning very wide table cells by slicing them from the source instead of rebuilding them one character at a time.

## 0.2.0 - 2026-05-08

### Added

- Added `markdownTableFencedCode: "markdown"` to collapse tables inside fenced code blocks marked `markdown`, `md`, `mdx`, or `gfm`.
- Kept `markdownTableFencedCode: "protected"` as the default so fenced code blocks stay unchanged unless callers opt in.

### Fixed

- Kept nested non-Markdown fences protected inside enabled Markdown fences.
- Kept indented code protected inside enabled Markdown fences, including blockquoted and indented fence examples.

## 0.1.1 - 2026-05-06

### Fixed

- Collapsed aligned tables when Prettier shortens tiny separator cells such as `:--`, `:-:`, and `--:`.

### Changed

- Lowered the supported runtime range to Node `>=20.19.0`.
- Added Node `20.x` to CI checks.

## 0.1.0 - 2026-05-05

Initial release.

### Added

- Added a Prettier 3 Markdown plugin that collapses Prettier's wide table alignment.
- Added `markdownTableStyle: "spaced"` as the default. It keeps one space inside each table cell.
- Added `markdownTableStyle: "compact"` for tables with no padding inside cells.
- Added `markdownTableStyle: "prettier"` to keep Prettier's built-in Markdown table output.
- Added the `normalizeMarkdownTables` helper for direct ESM imports.
- Added range and cursor support for editor integrations.
- Added protection for skipped regions such as code fences, HTML blocks, front matter, ignored ranges, MDX JSX, and MDX code-like content.

### Package Notes

- The package is ESM-only. CommonJS Prettier configs can load the plugin by package-name string, but direct `require("@dvyio/prettier-plugin-collapse-markdown-tables")` is not supported.
- The plugin must be the active Markdown printer. It does not compose with other plugins that also replace Prettier's Markdown `mdast` printer.
- Supported runtime range: Node `>=20.19.0` and Prettier `^3.0.0`.
