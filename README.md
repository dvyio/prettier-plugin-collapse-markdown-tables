# @dvyio/prettier-plugin-collapse-markdown-tables

Format Markdown tables without Prettier's wide column alignment.

The plugin runs after Prettier's Markdown printer. It keeps real Markdown tables readable while leaving code samples, ignored blocks, and MDX code-like content alone.

## Project Links

- Repository: [github.com/dvyio/prettier-plugin-collapse-markdown-tables](https://github.com/dvyio/prettier-plugin-collapse-markdown-tables)
- Report bugs: [GitHub issues](https://github.com/dvyio/prettier-plugin-collapse-markdown-tables/issues)
- Contributing: [CONTRIBUTING.md](https://github.com/dvyio/prettier-plugin-collapse-markdown-tables/blob/main/CONTRIBUTING.md)
- Security: [SECURITY.md](https://github.com/dvyio/prettier-plugin-collapse-markdown-tables/blob/main/SECURITY.md)
- License: [MIT](https://github.com/dvyio/prettier-plugin-collapse-markdown-tables/blob/main/LICENSE)

## Requirements

- Node `>=20.19.0`
- Prettier `^3.0.0`

The test suite checks the packed plugin with Prettier `3.0.0` and the current Prettier `3.x` release used by this repo.

CI runs `npm run check` and `npm run pack:check` on Node `20.x`, Node `22.x`, and Node `24.x`. Each Node job has two Prettier lanes: the lockfile install and a fresh `prettier@^3` install. That makes the package fail fast when either the minimum Node version, the supported Prettier peer range, or the packed release shape breaks.

Node versions newer than `24.x` are allowed by `engines.node` and are expected to work, but they are not separately certified by CI yet.

## Install

Install the plugin from npm with Prettier:

```bash
npm install --save-dev prettier @dvyio/prettier-plugin-collapse-markdown-tables
```

For local development, install this package's dependencies once:

```bash
npm install
```

Build this package before installing it from a local path:

```bash
npm run build
```

Then install it from the consuming project without running install scripts:

```bash
npm install --save-dev --ignore-scripts prettier ../prettier-plugin-collapse-markdown-tables
```

If you skip `--ignore-scripts`, npm may run pack lifecycle scripts while it copies a local path or git package. Use that only for sources you trust.

You can also test the package shape before publishing or installing it elsewhere:

```bash
npm run pack:check
```

Release notes and the version policy live in [CHANGELOG.md](https://github.com/dvyio/prettier-plugin-collapse-markdown-tables/blob/main/CHANGELOG.md).
Release steps live in [docs/release-runbook.md](https://github.com/dvyio/prettier-plugin-collapse-markdown-tables/blob/main/docs/release-runbook.md).

## Release

Before publishing a release, run the release gate:

```bash
npm run check:release
```

After `main` CI passes, GitHub Actions creates the release tag, publishes through npm trusted publishing, and creates the GitHub release. See [docs/release-runbook.md](https://github.com/dvyio/prettier-plugin-collapse-markdown-tables/blob/main/docs/release-runbook.md) for the full release flow.

## License

MIT. See [LICENSE](https://github.com/dvyio/prettier-plugin-collapse-markdown-tables/blob/main/LICENSE).

## Configure

Use the plugin from your Prettier config:

```json
{
  "plugins": ["@dvyio/prettier-plugin-collapse-markdown-tables"],
  "markdownTableStyle": "spaced"
}
```

You can also pass it on the CLI:

```bash
npx prettier --write README.md --plugin @dvyio/prettier-plugin-collapse-markdown-tables
```

This package is ESM-only. CommonJS projects can still load the plugin by package name from `.prettierrc.cjs`:

```js
module.exports = {
  plugins: ['@dvyio/prettier-plugin-collapse-markdown-tables'],
};
```

Do not call `require("@dvyio/prettier-plugin-collapse-markdown-tables")` from CommonJS code. This package does not ship a CommonJS build.

### Plugin Ordering

This plugin must be the active Markdown printer. It wraps Prettier's built-in Markdown printer, checks Prettier's Markdown AST for table nodes, then rewrites the final Markdown text only when the parsed document contains a table.

That final rewrite is an adapter boundary. Prettier owns Markdown and MDX parsing. This plugin owns a smaller post-print table pass, and it runs only after Prettier has already proved the document has Markdown table nodes. That keeps this package small, but it means parser wrapping, protected regions, range formatting, cursor mapping, and package compatibility need focused tests.

If another plugin also registers a Markdown `mdast` printer, only one printer runs. This plugin does not compose with that printer or use its custom output. It always wraps Prettier's built-in Markdown printer.

Put `@dvyio/prettier-plugin-collapse-markdown-tables` after other Markdown plugins when you want table collapsing to run. In that setup, this plugin replaces their Markdown printer for the final print step. If another Markdown printer appears after this plugin, that printer can replace this plugin and bypass table collapsing.

Reliable setup:

```json
{
  "plugins": [
    "another-markdown-printer",
    "@dvyio/prettier-plugin-collapse-markdown-tables"
  ],
  "markdownTableStyle": "spaced"
}
```

Avoid this order:

```json
{
  "plugins": [
    "@dvyio/prettier-plugin-collapse-markdown-tables",
    "another-markdown-printer"
  ]
}
```

## Options

### `markdownTableStyle: "spaced"`

This is the default. It writes one space inside each table cell.

Before:

```text
| Name  | Role        |
| ----- | ----------- |
| Davey | Builder     |
```

After:

```text
| Name | Role |
| --- | --- |
| Davey | Builder |
```

### `markdownTableStyle: "compact"`

This removes padding inside table cells.

Before:

```text
| Name  | Role        |
| ----- | ----------- |
| Davey | Builder     |
```

After:

```text
|Name|Role|
|---|---|
|Davey|Builder|
```

### `markdownTableStyle: "prettier"`

This turns the plugin's table rewrite off and keeps Prettier's built-in Markdown output.

Before:

```text
| Name | Role |
| --- | --- |
| Davey | Builder |
```

After:

```text
| Name  | Role    |
| ----- | ------- |
| Davey | Builder |
```

## Supported Contexts

The plugin normalizes normal Markdown tables at the root of a document, inside list items, inside blockquotes, inside mixed blockquote/list nesting, and inside footnotes parsed by Prettier's Markdown parser.

```text
> - Roles
>   | Name  | Role        |
>   | ----- | ----------- |
>   | Davey | Builder     |
```

becomes:

```text
> - Roles
>   | Name | Role |
>   | --- | --- |
>   | Davey | Builder |
```

MDX files are supported. Normal Markdown tables in MDX are normalized, but JSX and code-like MDX content is skipped.

## Repository Checks

`npm run format` uses `.prettierrc` without loading this plugin. That keeps normal source formatting independent from `dist`, README, CONTRIBUTING, SECURITY, and dogfood Markdown.

`npm run format:dogfood:check` builds the plugin first, then checks this README, `CONTRIBUTING.md`, `SECURITY.md`, and `tests/dogfood/markdown-tables.md` with the built plugin. That check runs after Prettier has already printed each file, so skipped regions are skipped by this plugin's collapse pass. Prettier can still format embedded languages before the collapse pass runs. `npm run check` runs both paths.

`npm run test:stress` runs the adversarial normalization cases with the stricter performance ceiling. Normal `npm run check` keeps a generous ceiling so slow CI workers still catch hangs without failing on benchmark noise.

Use [the audit coverage checklist](https://github.com/dvyio/prettier-plugin-collapse-markdown-tables/blob/main/docs/audit-checklist.md) before changing parser wrapping, range handling, protected-region scanning, table repair, rendering, packaging, or fixture coverage.

Maintainer setup, focused test commands, stress-test rules, fixture rules, and PR expectations live in [CONTRIBUTING.md](https://github.com/dvyio/prettier-plugin-collapse-markdown-tables/blob/main/CONTRIBUTING.md).

## Skipped Content

After Prettier prints the document, this plugin leaves these regions unchanged:

- fenced code blocks
- indented code blocks
- front matter, including YAML closed with `---` or `...`
- HTML comments
- HTML blocks, including `pre`, `script`, and `style`
- MDX JSX and ESM blocks
- tables after `<!-- prettier-ignore -->`
- tables inside `<!-- prettier-ignore-start -->` and `<!-- prettier-ignore-end -->`

That does not always mean the original input is kept byte for byte. Prettier may still format embedded languages before this plugin runs. For example, Prettier can align a Markdown table inside a `markdown` code fence, but this plugin will not collapse that fenced table to the configured table style.

For regions Prettier itself leaves alone, the collapse pass also leaves them alone. For example:

```text
<!-- prettier-ignore -->
| Name  | Role        |
| ----- | ----------- |
| Davey | Builder     |
```

stays exactly as Prettier printed it. The standalone `normalizeMarkdownTables` helper does not run Prettier first, so its protected-region behavior is byte-for-byte for the text you pass in.

## Safety Limits

The plugin is conservative. It leaves table-shaped text unchanged when it cannot prove the text is a valid table.

The plugin prints the full Markdown document before it collapses tables, so very large files can briefly need more than one full copy of the document in memory. Files with no pipe characters skip the collapse pass after printing. MDX JSX protection builds its full JSX scan text only after it sees a JSX-like block start. The test suite also runs a smoke test for hundreds of tables under a `192 MB` old-space limit and a `10 s` formatting limit.

It skips:

- bare GFM tables without outer pipes when you call the helper directly
- rows with mismatched header and delimiter cell counts
- delimiter rows with empty or malformed cells
- table rows with inconsistent list or blockquote prefixes
- malformed rows with unbalanced code spans
- ambiguous rows with too many unescaped pipes

Escaped pipes and pipes inside valid inline code spans are kept inside the cell.

Bare GFM tables behave differently in the plugin and the helper. `prettier.format` runs Prettier first, so a bare table such as `Name | Role` is printed as a pipe-wrapped table before this plugin collapses it. A direct `normalizeMarkdownTables` call does not run Prettier first, so the same bare table is returned unchanged.

## Public Helper

The package exports `normalizeMarkdownTables` for direct use from ESM code.

```ts
import { normalizeMarkdownTables } from '@dvyio/prettier-plugin-collapse-markdown-tables';

const markdown = normalizeMarkdownTables(prettierFormattedMarkdown, {
  markdownTableStyle: 'spaced',
});
```

Direct `require("@dvyio/prettier-plugin-collapse-markdown-tables")` calls are not supported. CommonJS code can use `await import("@dvyio/prettier-plugin-collapse-markdown-tables")` when it needs the helper.

Use it on Markdown that has already been formatted by Prettier. The helper rewrites pipe-wrapped tables only. Bare GFM tables are left unchanged unless you format them with Prettier before calling the helper. It preserves CR, CRLF, and LF line endings per line.

The helper scans the whole string it receives. If you use it in a server or with untrusted Markdown, cap the request body before calling it. Also set `maxInputBytes` so oversized strings fail before table scanning starts.

Helper options:

- `markdownTableStyle`: defaults to `'spaced'`. Use `'spaced'` for one space inside each cell, `'compact'` for no cell padding, or `'prettier'` to return the input unchanged.
- `maxInputBytes`: defaults to no helper-level limit. This rejects input whose UTF-8 size is larger than the limit. Use it for untrusted input, and set it to the same limit your service allows.
- `rangeStart`: defaults to `0` when `rangeEnd` is set. This is the start offset for the part of the input that may be rewritten. The value must be an integer from `0` through `markdown.length`.
- `rangeEnd`: defaults to `markdown.length` when `rangeStart` is set. This is the end offset for the part of the input that may be rewritten. Use `Number.POSITIVE_INFINITY` to mean the end of the input.
- `enableMdxEsm`: defaults to `false`. This is MDX-only. It protects MDX ESM imports, exports, and flow expressions from table rewriting.
- `enableMdxJsx`: defaults to `false`. This is MDX-only. It protects complete MDX JSX elements and fragments from table rewriting. Unclosed JSX-like tags are not protected by the MDX JSX scanner, so later Markdown tables can still be rewritten.

Ranges use JavaScript string offsets in the text passed to the helper. If only one range edge is set, the missing edge expands to the start or end of the input. Invalid offsets throw clear errors.

When `rangeStart` equals `rangeEnd`, the helper treats the range as a caret. A caret at the start of a table, inside table row text, or at the end of the last table row includes that table. A caret on the blank line before or after a table does not include it.

Prettier itself returns unchanged text for collapsed ranges before plugins run. Editor integrations that need caret-style table cleanup should call `normalizeMarkdownTables` directly or expand the Prettier range to include table text.
