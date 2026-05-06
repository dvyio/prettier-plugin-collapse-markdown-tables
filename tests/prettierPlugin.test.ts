import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import * as prettier from 'prettier';
import * as prettierMarkdownPlugin from 'prettier/plugins/markdown';
import { beforeAll, describe, expect, test } from 'vitest';

import plugin from '../src/index.js';
import {
  type MarkdownTableStyle,
  normalizeMarkdownTables,
} from '../src/normalizeMarkdownTables.js';

const CLI_PLUGIN_PATH = './dist/index.js';
const PACKAGE_NAME = readPackageName();
const PRETTIER_BIN_PATH = './node_modules/prettier/bin/prettier.cjs';
const TSC_BIN_PATH = './node_modules/typescript/bin/tsc';
const DEFAULT_CLI_TIMEOUT_MS = 30_000;
const PERFORMANCE_TEST_TIMEOUT_BUFFER_MS = 5_000;
const STRICT_LARGE_PLUGIN_FORMAT_TIMEOUT_MS = 10_000;
const CATASTROPHIC_LARGE_PLUGIN_FORMAT_TIMEOUT_MS = 30_000;
const STRICT_LARGE_NO_PIPE_PLUGIN_FORMAT_TIMEOUT_MS = 5_000;
const CATASTROPHIC_LARGE_NO_PIPE_PLUGIN_FORMAT_TIMEOUT_MS = 15_000;
const STRICT_WIDE_CURSOR_MAPPING_TIMEOUT_MS = 5_000;
const CATASTROPHIC_WIDE_CURSOR_MAPPING_TIMEOUT_MS = 20_000;
const STRICT_LARGE_PLUGIN_RETAINED_HEAP_LIMIT_BYTES = 128 * 1_024 * 1_024;
const CATASTROPHIC_LARGE_PLUGIN_RETAINED_HEAP_LIMIT_BYTES = 180 * 1_024 * 1_024;
const IS_STRICT_PERFORMANCE_TEST =
  process.env.NORMALIZE_MARKDOWN_TABLES_STRESS === '1';
const PERFORMANCE_TEST_MODE = IS_STRICT_PERFORMANCE_TEST
  ? 'strict'
  : 'generous';
const LARGE_PLUGIN_FORMAT_TIMEOUT_MS = IS_STRICT_PERFORMANCE_TEST
  ? STRICT_LARGE_PLUGIN_FORMAT_TIMEOUT_MS
  : CATASTROPHIC_LARGE_PLUGIN_FORMAT_TIMEOUT_MS;
const LARGE_NO_PIPE_PLUGIN_FORMAT_TIMEOUT_MS = IS_STRICT_PERFORMANCE_TEST
  ? STRICT_LARGE_NO_PIPE_PLUGIN_FORMAT_TIMEOUT_MS
  : CATASTROPHIC_LARGE_NO_PIPE_PLUGIN_FORMAT_TIMEOUT_MS;
const LARGE_NO_PIPE_PLUGIN_TEST_TIMEOUT_MS =
  LARGE_NO_PIPE_PLUGIN_FORMAT_TIMEOUT_MS + PERFORMANCE_TEST_TIMEOUT_BUFFER_MS;
const WIDE_CURSOR_MAPPING_TIMEOUT_MS = IS_STRICT_PERFORMANCE_TEST
  ? STRICT_WIDE_CURSOR_MAPPING_TIMEOUT_MS
  : CATASTROPHIC_WIDE_CURSOR_MAPPING_TIMEOUT_MS;
const LARGE_PLUGIN_RETAINED_HEAP_LIMIT_BYTES = IS_STRICT_PERFORMANCE_TEST
  ? STRICT_LARGE_PLUGIN_RETAINED_HEAP_LIMIT_BYTES
  : CATASTROPHIC_LARGE_PLUGIN_RETAINED_HEAP_LIMIT_BYTES;
const NPM_COMMAND = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const PRETTIER_SEMANTIC_FUZZ_SEED = 0x5eed_2026;
const GENERATED_JAVASCRIPT_BANNER =
  '// @generated - do not edit. Source: npm run build';
const INVALID_MARKDOWN_TABLE_STYLES = ['wide', ''] as const;
const EXPECTED_PACKAGE_NAME = '@dvyio/prettier-plugin-collapse-markdown-tables';
const EXPECTED_PACKAGE_REPOSITORY_URL =
  'git+https://github.com/dvyio/prettier-plugin-collapse-markdown-tables.git';
const EXPECTED_PACKAGE_URL =
  'https://github.com/dvyio/prettier-plugin-collapse-markdown-tables';
const ANSI_ESCAPE_CHARACTER = String.fromCharCode(27);
const ANSI_ESCAPE_PATTERN = new RegExp(
  `${ANSI_ESCAPE_CHARACTER}\\[[0-?]*[ -/]*[@-~]`,
  'gu',
);

const markdown = [
  '| Name | Role |',
  '| --- | --- |',
  '| Davey | Builder |',
  '| Codex | Pair worker |',
  '',
].join('\n');

const mockMarkdownPrinterOutput = 'mock markdown printer output\n';

type MockMarkdownNode = {
  readonly children?: ReadonlyArray<MockMarkdownNode>;
  readonly type?: string;
};

const mockMarkdownPrinterPlugin: prettier.Plugin<MockMarkdownNode> = {
  parsers: prettierMarkdownPlugin.parsers,
  printers: {
    mdast: {
      ...prettierMarkdownPlugin.printers.mdast,
      print() {
        return mockMarkdownPrinterOutput;
      },
    },
  },
};

const unnormalizedMarkdown = [
  '| Name  | Role        |',
  '| ----- | ----------- |',
  '| Davey | Builder     |',
  '| Codex | Pair worker |',
  '',
].join('\n');

type CliResult = {
  readonly status: null | number;
  readonly stderr: string;
  readonly stdout: string;
};

type CliRunOptions = {
  readonly cwd?: string;
  readonly timeoutMs?: number;
};

type StderrMatcher = (stderr: string) => boolean;

type AllowedStderr = StderrMatcher | string;

type FixtureParser = 'markdown' | 'mdx';

type FormatFixture = {
  readonly fileName: string;
  readonly parser: FixtureParser;
};

type PrettierCompatibilityPackage = {
  readonly label: string;
  readonly packageName: string;
};

type TableAlignment = 'center' | 'left' | 'none' | 'right';

type InlineNodeSemantics = {
  readonly children?: ReadonlyArray<InlineNodeSemantics>;
  readonly title?: string;
  readonly type: string;
  readonly url?: string;
  readonly value?: string;
};

type TableSemantics = ReadonlyArray<{
  readonly align: ReadonlyArray<TableAlignment>;
  readonly rows: ReadonlyArray<
    ReadonlyArray<ReadonlyArray<InlineNodeSemantics>>
  >;
}>;

type TemporaryMarkdownFile = {
  readonly directory: string;
  readonly filePath: string;
};

type CursorTextExpectation = {
  readonly cursorText: string;
  readonly markdown: string;
  readonly options?: {
    readonly markdownTableStyle?: MarkdownTableStyle;
  };
  readonly textBeforeCursor: string;
};

type CursorOccurrenceExpectation = {
  readonly cursorText: string;
  readonly markdown: string;
  readonly occurrenceIndex: number;
  readonly options?: {
    readonly markdownTableStyle?: MarkdownTableStyle;
    readonly rangeEnd?: number;
    readonly rangeStart?: number;
  };
  readonly textBeforeCursor: string;
};

type RangeTableStyleCase = {
  readonly expectedSelectedTable: string;
  readonly label: string;
  readonly markdownTableStyle?: MarkdownTableStyle;
};

type PrettierDebugApi = {
  readonly parse: (
    markdown: string,
    options: prettier.Options,
  ) => Promise<unknown> | unknown;
  readonly printDocToString: (
    doc: unknown,
    options: prettier.Options,
  ) => Promise<PrintedDocResult>;
  readonly printToDoc: (
    markdown: string,
    options: prettier.Options,
  ) => Promise<unknown>;
};

type PrintedDocResult = {
  readonly formatted: string;
};

type NpmPackFile = {
  readonly path: string;
};

type NpmPackResult = {
  readonly files: ReadonlyArray<NpmPackFile>;
};

type UnknownFunction = (...args: ReadonlyArray<unknown>) => unknown;

type SeededRandom = {
  readonly next: () => number;
};

const FIXTURE_STYLES: ReadonlyArray<MarkdownTableStyle> = [
  'spaced',
  'compact',
  'prettier',
];

const FORMAT_FIXTURES: ReadonlyArray<FormatFixture> = [
  {
    fileName: 'markdown-contexts.md',
    parser: 'markdown',
  },
  {
    fileName: 'mdx-contexts.mdx',
    parser: 'mdx',
  },
];

const RANGE_TABLE_STYLE_CASES: ReadonlyArray<RangeTableStyleCase> = [
  {
    expectedSelectedTable: [
      '| Pick | Value |',
      '| --- | --- |',
      '| yes | 1 |',
    ].join('\n'),
    label: 'default style',
  },
  {
    expectedSelectedTable: [
      '| Pick | Value |',
      '| --- | --- |',
      '| yes | 1 |',
    ].join('\n'),
    label: 'explicit spaced style',
    markdownTableStyle: 'spaced',
  },
  {
    expectedSelectedTable: ['|Pick|Value|', '|---|---|', '|yes|1|'].join('\n'),
    label: 'compact style',
    markdownTableStyle: 'compact',
  },
];

const PRETTIER_COMPATIBILITY_PACKAGES: ReadonlyArray<PrettierCompatibilityPackage> =
  [
    {
      label: 'minimum Prettier peer',
      packageName: 'prettier-3-0',
    },
    {
      label: 'current Prettier peer',
      packageName: 'prettier',
    },
  ];

describe('prettier plugin', () => {
  beforeAll(() => {
    buildCliPlugin();
  });

  test('given CR-only output, when printing to a doc, then no doc string contains embedded line endings', async () => {
    const script = `
      import * as prettier from 'prettier';
      import plugin from './dist/index.js';

      const markdown = [
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '| Codex | Pair worker |',
        '',
      ].join('\\n');
      const doc = await prettier.__debug.printToDoc(markdown, {
        endOfLine: 'cr',
        parser: 'markdown',
        plugins: [plugin],
      });
      const match = findStringWithLineEnding(doc);

      if (match !== undefined) {
        console.error(match);
        process.exit(1);
      }

      function findStringWithLineEnding(value) {
        if (typeof value === 'string') {
          return value.includes('\\n') || value.includes('\\r') ? value : undefined;
        }

        if (!Array.isArray(value)) {
          return undefined;
        }

        for (const item of value) {
          const match = findStringWithLineEnding(item);

          if (match !== undefined) {
            return match;
          }
        }

        return undefined;
      }
    `;

    const result = runNodeCli(['--input-type=module', '--eval', script]);

    expectCliStatus(result, 0);
    expect(result.stderr).toBe('');
  });

  test('given markdown tables, when formatting by default, then writes spaced tables', async () => {
    await expect(
      prettier.format(markdown, {
        parser: 'markdown',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      [
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '| Codex | Pair worker |',
        '',
      ].join('\n'),
    );
  });

  test('given Prettier shortens aligned separator cells, when formatting Markdown, then it still collapses the table', async () => {
    const alignedMarkdown = [
      '| L | C | R |',
      '| :--- | :---: | ---: |',
      '| a | b | c |',
      '',
    ].join('\n');

    await expect(
      prettier.format(alignedMarkdown, {
        parser: 'markdown',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      ['| L | C | R |', '| :--- | :---: | ---: |', '| a | b | c |', ''].join(
        '\n',
      ),
    );
  });

  test('given a bare GFM table, when formatting by default, then writes a spaced pipe table', async () => {
    const bareTable = [
      'Name  | Role',
      '----- | -----------',
      'Davey | Builder',
      '',
    ].join('\n');

    await expect(
      prettier.format(bareTable, {
        parser: 'markdown',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      ['| Name | Role |', '| --- | --- |', '| Davey | Builder |', ''].join(
        '\n',
      ),
    );
  });

  test('given an embedded Markdown code fence, when formatting, then Prettier can align it before this plugin skips collapse', async () => {
    const fencedMarkdown = [
      '```markdown',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '```',
      '',
    ].join('\n');

    await expect(
      prettier.format(fencedMarkdown, {
        parser: 'markdown',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      [
        '```markdown',
        '| Name  | Role    |',
        '| ----- | ------- |',
        '| Davey | Builder |',
        '```',
        '',
      ].join('\n'),
    );
  });

  test('given the Markdown plugin loads before this plugin, when formatting, then this plugin is the active printer', async () => {
    await expect(
      prettier.format(markdown, {
        parser: 'markdown',
        plugins: [prettierMarkdownPlugin, plugin],
      }),
    ).resolves.toBe(
      [
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '| Codex | Pair worker |',
        '',
      ].join('\n'),
    );
  });

  test('given the Markdown plugin loads after this plugin, when formatting, then Prettier uses the later Markdown printer', async () => {
    const prettierOutput = await prettier.format(markdown, {
      parser: 'markdown',
      plugins: [prettierMarkdownPlugin],
    });
    const pluginOutput = await prettier.format(markdown, {
      parser: 'markdown',
      plugins: [plugin, prettierMarkdownPlugin],
    });

    expect(pluginOutput).toBe(prettierOutput);
    expect(pluginOutput).not.toBe(
      [
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '| Codex | Pair worker |',
        '',
      ].join('\n'),
    );
  });

  test('given another Markdown printer loads before this plugin, when formatting, then this plugin wraps the built-in printer', async () => {
    const output = await prettier.format(markdown, {
      parser: 'markdown',
      plugins: [mockMarkdownPrinterPlugin, plugin],
    });

    expect(output).toBe(
      [
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '| Codex | Pair worker |',
        '',
      ].join('\n'),
    );
    expect(output).not.toBe(mockMarkdownPrinterOutput);
  });

  test('given another Markdown printer loads after this plugin, when formatting, then that printer replaces this plugin', async () => {
    await expect(
      prettier.format(markdown, {
        parser: 'markdown',
        plugins: [plugin, mockMarkdownPrinterPlugin],
      }),
    ).resolves.toBe(mockMarkdownPrinterOutput);
  });

  test('given compact style, when formatting, then writes compact tables', async () => {
    await expect(
      prettier.format(markdown, {
        markdownTableStyle: 'compact',
        parser: 'markdown',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      [
        '|Name|Role|',
        '|---|---|',
        '|Davey|Builder|',
        '|Codex|Pair worker|',
        '',
      ].join('\n'),
    );
  });

  test('given an invalid table style, when formatting through the Prettier API, then it rejects with the valid choices', async () => {
    for (const invalidStyle of INVALID_MARKDOWN_TABLE_STYLES) {
      await expectInvalidMarkdownTableStyleRejection(
        formatWithUntypedOptions(markdown, {
          markdownTableStyle: invalidStyle,
          parser: 'markdown',
          plugins: [plugin],
        }),
        invalidStyle,
      );
    }
  });

  test('given prettier style, when formatting, then matches Prettier Markdown output', async () => {
    const options = {
      parser: 'markdown',
      plugins: [prettierMarkdownPlugin],
    } satisfies prettier.Options;

    const prettierOutput = await prettier.format(markdown, options);
    const pluginOutput = await prettier.format(markdown, {
      markdownTableStyle: 'prettier',
      parser: 'markdown',
      plugins: [plugin],
    });

    expect(pluginOutput).toBe(prettierOutput);
  });

  test('given the remark parser, when formatting by default, then writes spaced tables', async () => {
    await expect(
      prettier.format(unnormalizedMarkdown, {
        parser: 'remark',
        plugins: [plugin],
      }),
    ).resolves.toBe(markdown);
  });

  test('given the remark parser and compact style, when formatting, then writes compact tables', async () => {
    await expect(
      prettier.format(unnormalizedMarkdown, {
        markdownTableStyle: 'compact',
        parser: 'remark',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      [
        '|Name|Role|',
        '|---|---|',
        '|Davey|Builder|',
        '|Codex|Pair worker|',
        '',
      ].join('\n'),
    );
  });

  test('given the remark parser and prettier style, when formatting, then matches Prettier Markdown output', async () => {
    const options = {
      parser: 'remark',
      plugins: [prettierMarkdownPlugin],
    } satisfies prettier.Options;

    const prettierOutput = await prettier.format(unnormalizedMarkdown, options);
    const pluginOutput = await prettier.format(unnormalizedMarkdown, {
      markdownTableStyle: 'prettier',
      parser: 'remark',
      plugins: [plugin],
    });

    expect(pluginOutput).toBe(prettierOutput);
  });

  test('given a table inside a footnote, when formatting Markdown, then collapses the footnote table', async () => {
    const source = [
      'Footnote ref.[^roles]',
      '',
      '[^roles]: Roles',
      '',
      '    | Name  | Role        |',
      '    | ----- | ----------- |',
      '    | Davey | Builder     |',
      '',
      'After.',
      '',
    ].join('\n');

    await expect(
      prettier.format(source, {
        parser: 'markdown',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      [
        'Footnote ref.[^roles]',
        '',
        '[^roles]: Roles',
        '',
        '    | Name | Role |',
        '    | --- | --- |',
        '    | Davey | Builder |',
        '',
        'After.',
        '',
      ].join('\n'),
    );
  });

  test('given MDX with code-shaped table text, when formatting, then only normalizes the Markdown table', async () => {
    const mdx = [
      'import Demo from "./Demo";',
      '',
      'export const sample = `',
      '| Code  | Meaning |',
      '| ----- | ------- |',
      '| a     | b       |',
      '`;',
      '',
      '<Demo>{`',
      '| Code  | Meaning |',
      '| ----- | ------- |',
      '| a     | b       |',
      '`}</Demo>',
      '',
      '<pre>',
      '| Code  | Meaning |',
      '| ----- | ------- |',
      '| a     | b       |',
      '</pre>',
      '',
      '<code>',
      '| Code  | Meaning |',
      '| ----- | ------- |',
      '| a     | b       |',
      '</code>',
      '',
      '```md',
      '| Code  | Meaning |',
      '| ----- | ------- |',
      '| a     | b       |',
      '```',
      '',
      '| Name  | Role    |',
      '| ----- | ------- |',
      '| Davey | Builder |',
      '',
    ].join('\n');

    await expect(
      prettier.format(mdx, {
        parser: 'mdx',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      [
        'import Demo from "./Demo";',
        '',
        'export const sample = `',
        '| Code  | Meaning |',
        '| ----- | ------- |',
        '| a     | b       |',
        '`;',
        '',
        '<Demo>{`',
        '| Code  | Meaning |',
        '| ----- | ------- |',
        '| a     | b       |',
        '`}</Demo>',
        '',
        '<pre>| Code | Meaning | | ----- | ------- | | a | b |</pre>',
        '',
        '<code>| Code | Meaning | | ----- | ------- | | a | b |</code>',
        '',
        '```md',
        '| Code | Meaning |',
        '| ---- | ------- |',
        '| a    | b       |',
        '```',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '',
      ].join('\n'),
    );
  });

  test('given MDX JSX lowercase elements and fragments, when formatting, then it does not collapse JSX child text', async () => {
    const mdx = [
      '<div>',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '</div>',
      '',
      '<>',
      '| Tool  | Use         |',
      '| ----- | ----------- |',
      '| Codex | Pair worker |',
      '</>',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
    ].join('\n');

    await expect(
      prettier.format(mdx, {
        parser: 'mdx',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      [
        '<div>| Name | Role | | ----- | ----------- | | Davey | Builder |</div>',
        '',
        '<>| Tool | Use | | ----- | ----------- | | Codex | Pair worker |</>',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '',
      ].join('\n'),
    );
  });

  test('given Markdown and remark custom tags before tables, when formatting, then tables still collapse', async () => {
    const markdownWithCustomTag = [
      '<CustomThing>',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
    ].join('\n');
    const expected = [
      '<CustomThing>',
      '',
      '| Name | Role |',
      '| --- | --- |',
      '| Davey | Builder |',
      '',
    ].join('\n');

    await expect(
      prettier.format(markdownWithCustomTag, {
        parser: 'markdown',
        plugins: [plugin],
      }),
    ).resolves.toBe(expected);
    await expect(
      prettier.format(markdownWithCustomTag, {
        parser: 'remark',
        plugins: [plugin],
      }),
    ).resolves.toBe(expected);
  });

  test('given HTML declarations and CDATA before tables, when formatting Markdown, then following tables collapse', async () => {
    const markdownWithHtmlBlocks = [
      '<!doctype html>',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
      '<?xml version="1.0"?>',
      '| Tool  | Use         |',
      '| ----- | ----------- |',
      '| Codex | Pair worker |',
      '',
      '<![CDATA[',
      '| Raw   | Table       |',
      '| ----- | ----------- |',
      '| keep  | spacing     |',
      ']]>',
      '| After | Table       |',
      '| ----- | ----------- |',
      '| yes   | 1           |',
      '',
    ].join('\n');

    await expect(
      prettier.format(markdownWithHtmlBlocks, {
        parser: 'markdown',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      [
        '<!doctype html>',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '',
        '<?xml version="1.0"?>',
        '',
        '| Tool | Use |',
        '| --- | --- |',
        '| Codex | Pair worker |',
        '',
        '<![CDATA[',
        '| Raw   | Table       |',
        '| ----- | ----------- |',
        '| keep  | spacing     |',
        ']]>',
        '',
        '| After | Table |',
        '| --- | --- |',
        '| yes | 1 |',
        '',
      ].join('\n'),
    );
  });

  test('given textarea contains a table after a blank line, when formatting Markdown, then textarea content stays protected', async () => {
    const markdownWithTextarea = [
      '<textarea>',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '</textarea>',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
    ].join('\n');

    await expect(
      prettier.format(markdownWithTextarea, {
        parser: 'markdown',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      [
        '<textarea>',
        '',
        '| Name  | Role    |',
        '| ----- | ------- |',
        '| Davey | Builder |',
        '',
        '</textarea>',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '',
      ].join('\n'),
    );
  });

  test('given raw HTML closing tags use casing or whitespace, when formatting Markdown, then following tables collapse', async () => {
    const markdownWithRawHtml = [
      '<pre>',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '</PRE>',
      '| After | Table       |',
      '| ----- | ----------- |',
      '| yes   | 1           |',
      '',
      '<script>',
      'const rows = `',
      '| Tool  | Use         |',
      '| ----- | ----------- |',
      '| Codex | Pair worker |',
      '`;',
      '</script >',
      '| Next  | Table       |',
      '| ----- | ----------- |',
      '| yes   | 2           |',
      '',
    ].join('\n');

    await expect(
      prettier.format(markdownWithRawHtml, {
        parser: 'markdown',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      [
        '<pre>',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '</PRE>',
        '',
        '| After | Table |',
        '| --- | --- |',
        '| yes | 1 |',
        '',
        '<script>',
        'const rows = `',
        '| Tool  | Use         |',
        '| ----- | ----------- |',
        '| Codex | Pair worker |',
        '`;',
        '</script >',
        '| Next | Table |',
        '| --- | --- |',
        '| yes | 2 |',
        '',
      ].join('\n'),
    );
  });

  test('given Markdown prose starts with import and export, when formatting, then normalizes following tables', async () => {
    const markdownProse = [
      'import notes can be ordinary prose.',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
      'export controls can be ordinary prose.',
      '',
      '| Tool  | Use         |',
      '| ----- | ----------- |',
      '| Codex | Pair worker |',
      '',
    ].join('\n');

    await expect(
      prettier.format(markdownProse, {
        parser: 'markdown',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      [
        'import notes can be ordinary prose.',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '',
        'export controls can be ordinary prose.',
        '',
        '| Tool | Use |',
        '| --- | --- |',
        '| Codex | Pair worker |',
        '',
      ].join('\n'),
    );
  });

  test('given MDX with semicolonless ESM, when formatting, then protects only the ESM declaration', async () => {
    const mdx = [
      'import Demo from "./Demo"',
      '',
      'export const sample = `',
      '| Code  | Meaning |',
      '| ----- | ------- |',
      '| a     | b       |',
      '`',
      '',
      '| Name  | Role    |',
      '| ----- | ------- |',
      '| Davey | Builder |',
      '',
    ].join('\n');

    await expect(
      prettier.format(mdx, {
        parser: 'mdx',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      [
        'import Demo from "./Demo";',
        '',
        'export const sample = `',
        '| Code  | Meaning |',
        '| ----- | ------- |',
        '| a     | b       |',
        '`;',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '',
      ].join('\n'),
    );
  });

  test('given MDX ESM comments and regex literals, when formatting, then normalizes the following Markdown table', async () => {
    const mdx = [
      'export const brace = 1; // {',
      'export const tick = 2; // `',
      'export const pattern = /{/;',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
    ].join('\n');

    await expect(
      prettier.format(mdx, {
        parser: 'mdx',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      [
        'export const brace = 1; // {',
        'export const tick = 2; // `',
        'export const pattern = /{/;',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '',
      ].join('\n'),
    );
  });

  test('given TypeScript-style MDX ESM exports, when formatting, then protects table-shaped strings', async () => {
    const mdx = [
      'export declare const declaredSample: {',
      '  table: "',
      '| Declare  | Value     |',
      '| -------- | --------- |',
      '| keep     | spacing   |',
      '  ";',
      '};',
      '',
      'export namespace Samples {',
      '  export const table = `',
      '| Namespace | Value     |',
      '| --------- | --------- |',
      '| keep      | spacing   |',
      '  `;',
      '}',
      '',
      'export abstract class AbstractSample {',
      '  table = `',
      '| Abstract | Value     |',
      '| -------- | --------- |',
      '| keep     | spacing   |',
      '  `;',
      '}',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
    ].join('\n');

    await expect(
      prettier.format(mdx, {
        parser: 'mdx',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      [
        'export declare const declaredSample: {',
        '  table: "',
        '| Declare  | Value     |',
        '| -------- | --------- |',
        '| keep     | spacing   |',
        '  ";',
        '};',
        '',
        'export namespace Samples {',
        '  export const table = `',
        '| Namespace | Value     |',
        '| --------- | --------- |',
        '| keep      | spacing   |',
        '  `;',
        '}',
        '',
        'export abstract class AbstractSample {',
        '  table = `',
        '| Abstract | Value     |',
        '| -------- | --------- |',
        '| keep     | spacing   |',
        '  `;',
        '}',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '',
      ].join('\n'),
    );
  });

  test('given CRLF line endings, when formatting, then keeps Prettier line endings', async () => {
    await expect(
      prettier.format(markdown, {
        endOfLine: 'crlf',
        parser: 'markdown',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      [
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '| Codex | Pair worker |',
        '',
      ].join('\r\n'),
    );
  });

  test('given CR-only line endings, when formatting, then keeps Prettier line endings', async () => {
    await expect(
      prettier.format(markdown, {
        endOfLine: 'cr',
        parser: 'markdown',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      [
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '| Codex | Pair worker |',
        '',
      ].join('\r'),
    );
  });

  test('given CRLF line endings and a table range, when formatting, then normalizes only the selected table', async () => {
    const beforeTable = [
      '| Before  | Table       |',
      '| ------- | ----------- |',
      '| keep    | as written  |',
    ].join('\r\n');
    const selectedTable = [
      '| Pick  | Value       |',
      '| ----- | ----------- |',
      '| yes   | 1           |',
    ].join('\r\n');
    const afterTable = [
      '| After   | Table       |',
      '| ------- | ----------- |',
      '| keep    | as written  |',
    ].join('\r\n');
    const rangedMarkdown = [
      beforeTable,
      '',
      selectedTable,
      '',
      afterTable,
      '',
    ].join('\r\n');
    const rangeStart = rangedMarkdown.indexOf('Pick');
    const rangeEnd = rangeStart + 'Pick'.length;

    await expect(
      prettier.format(rangedMarkdown, {
        endOfLine: 'crlf',
        parser: 'markdown',
        plugins: [plugin],
        rangeEnd,
        rangeStart,
      }),
    ).resolves.toBe(
      [
        beforeTable,
        '',
        '| Pick | Value |',
        '| --- | --- |',
        '| yes | 1 |',
        '',
        afterTable,
        '',
      ].join('\r\n'),
    );
  });

  test('given a CRLF separator offset between tables, when range formatting, then it does not normalize neighboring tables', async () => {
    const beforeTable = [
      '| Before  | Table       |',
      '| ------- | ----------- |',
      '| keep    | as written  |',
    ].join('\r\n');
    const afterTable = [
      '| After   | Table       |',
      '| ------- | ----------- |',
      '| keep    | as written  |',
    ].join('\r\n');
    const rangedMarkdown = [beforeTable, afterTable, ''].join('\r\n');
    const separatorOffset = rangedMarkdown.indexOf('\r\n') + 1;

    await expect(
      prettier.format(rangedMarkdown, {
        endOfLine: 'crlf',
        parser: 'markdown',
        plugins: [plugin],
        rangeEnd: separatorOffset,
        rangeStart: separatorOffset,
      }),
    ).resolves.toBe(rangedMarkdown);
  });

  test('given CRLF separator offsets surround one table, when range formatting, then only that table is normalized', async () => {
    const beforeTable = [
      '| Before  | Table       |',
      '| ------- | ----------- |',
      '| keep    | as written  |',
    ].join('\r\n');
    const selectedTable = [
      '| Pick  | Value       |',
      '| ----- | ----------- |',
      '| yes   | 1           |',
    ].join('\r\n');
    const afterTable = [
      '| After   | Table       |',
      '| ------- | ----------- |',
      '| keep    | as written  |',
    ].join('\r\n');
    const rangedMarkdown = [
      beforeTable,
      '',
      selectedTable,
      '',
      afterTable,
      '',
    ].join('\r\n');
    const separatorBeforeSelected = rangedMarkdown.indexOf(
      `\r\n${selectedTable}`,
    );
    const separatorAfterSelected = rangedMarkdown.indexOf(`\r\n${afterTable}`);
    const rangeStart = separatorBeforeSelected + 1;
    const rangeEnd = separatorAfterSelected + 1;

    await expect(
      prettier.format(rangedMarkdown, {
        endOfLine: 'crlf',
        parser: 'markdown',
        plugins: [plugin],
        rangeEnd,
        rangeStart,
      }),
    ).resolves.toBe(
      [
        beforeTable,
        '',
        '| Pick | Value |',
        '| --- | --- |',
        '| yes | 1 |',
        '',
        afterTable,
        '',
      ].join('\r\n'),
    );
  });

  test('given CR-only line endings and a table range, when formatting, then normalizes only the selected table', async () => {
    const beforeTable = [
      '| Before  | Table       |',
      '| ------- | ----------- |',
      '| keep    | as written  |',
    ].join('\r');
    const selectedTable = [
      '| Pick  | Value       |',
      '| ----- | ----------- |',
      '| yes   | 1           |',
    ].join('\r');
    const afterTable = [
      '| After   | Table       |',
      '| ------- | ----------- |',
      '| keep    | as written  |',
    ].join('\r');
    const rangedMarkdown = [
      beforeTable,
      '',
      selectedTable,
      '',
      afterTable,
      '',
    ].join('\r');
    const rangeStart = rangedMarkdown.indexOf('Pick');
    const rangeEnd = rangeStart + 'Pick'.length;

    await expect(
      prettier.format(rangedMarkdown, {
        endOfLine: 'cr',
        parser: 'markdown',
        plugins: [plugin],
        rangeEnd,
        rangeStart,
      }),
    ).resolves.toBe(
      [
        beforeTable,
        '',
        '| Pick | Value |',
        '| --- | --- |',
        '| yes | 1 |',
        '',
        afterTable,
        '',
      ].join('\r'),
    );
  });

  test('given a range outside a table, when formatting, then leaves that table unchanged', async () => {
    const rangedMarkdown = [
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
      'Target paragraph   with   spaces.',
      '',
    ].join('\n');
    const rangeStart = rangedMarkdown.indexOf('Target');
    const rangeEnd = rangeStart + 'Target paragraph'.length;

    await expect(
      prettier.format(rangedMarkdown, {
        parser: 'markdown',
        plugins: [plugin],
        rangeEnd,
        rangeStart,
      }),
    ).resolves.toBe(rangedMarkdown);
  });

  for (const rangeStyleCase of RANGE_TABLE_STYLE_CASES) {
    test(`given ${rangeStyleCase.label} and a paragraph range between tables, when formatting, then leaves both tables unchanged`, async () => {
      const beforeTable = [
        '| Before  | Table       |',
        '| ------- | ----------- |',
        '| keep    | as written  |',
      ].join('\n');
      const afterTable = [
        '| After   | Table       |',
        '| ------- | ----------- |',
        '| keep    | as written  |',
      ].join('\n');
      const rangedMarkdown = [
        beforeTable,
        '',
        'Target paragraph   with   spaces.',
        '',
        afterTable,
        '',
      ].join('\n');
      const rangeStart = rangedMarkdown.indexOf('Target');
      const rangeEnd = rangeStart + 'Target paragraph'.length;

      await expect(
        prettier.format(
          rangedMarkdown,
          withOptionalMarkdownTableStyle(
            {
              parser: 'markdown',
              plugins: [plugin],
              rangeEnd,
              rangeStart,
            },
            rangeStyleCase.markdownTableStyle,
          ),
        ),
      ).resolves.toBe(rangedMarkdown);
    });
  }

  test('given a range containing a table, when formatting, then normalizes that table', async () => {
    const rangedMarkdown = [
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
      'Target paragraph   with   spaces.',
      '',
    ].join('\n');
    const rangeStart = rangedMarkdown.indexOf('| Name');
    const rangeEnd =
      rangedMarkdown.indexOf('| Davey') + '| Davey | Builder     |'.length;

    await expect(
      prettier.format(rangedMarkdown, {
        parser: 'markdown',
        plugins: [plugin],
        rangeEnd,
        rangeStart,
      }),
    ).resolves.toBe(
      [
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '',
        'Target paragraph   with   spaces.',
        '',
      ].join('\n'),
    );
  });

  test('given a range starts after the final table row, when formatting, then leaves the table unchanged', async () => {
    const rangedMarkdown = [
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
      'Outro paragraph.',
      '',
    ].join('\n');
    const normalized = [
      '| Name | Role |',
      '| --- | --- |',
      '| Davey | Builder |',
      '',
      'Outro paragraph.',
      '',
    ].join('\n');
    const finalRowEnd =
      rangedMarkdown.indexOf('| Davey') + '| Davey | Builder     |'.length;

    await expect(
      prettier.format(rangedMarkdown, {
        parser: 'markdown',
        plugins: [plugin],
        rangeEnd: finalRowEnd + 1,
        rangeStart: finalRowEnd,
      }),
    ).resolves.toBe(rangedMarkdown);

    await expect(
      prettier.format(rangedMarkdown, {
        parser: 'markdown',
        plugins: [plugin],
        rangeEnd: finalRowEnd,
        rangeStart: finalRowEnd - 1,
      }),
    ).resolves.toBe(normalized);
  });

  test('given zero-length ranges at table boundaries, when formatting with Prettier, then Prettier leaves text unchanged before plugins run', async () => {
    const table = [
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');
    const rangedMarkdown = ['Intro', '', table, '', 'Outro', ''].join('\n');
    const tableStart = rangedMarkdown.indexOf('| Name');
    const insideHeaderText = rangedMarkdown.indexOf('Name');
    const betweenHeaderAndDelimiter = rangedMarkdown.indexOf('| -----');
    const tableEnd =
      rangedMarkdown.indexOf('| Davey') + '| Davey | Builder     |'.length;
    const blankLineBeforeTable = rangedMarkdown.indexOf('\n\n| Name') + 1;
    const blankLineAfterTable = tableEnd + 1;

    for (const rangeStart of [
      tableStart,
      insideHeaderText,
      betweenHeaderAndDelimiter,
      tableEnd,
    ]) {
      await expect(
        prettier.format(rangedMarkdown, {
          parser: 'markdown',
          plugins: [plugin],
          rangeEnd: rangeStart,
          rangeStart,
        }),
      ).resolves.toBe(rangedMarkdown);
    }

    for (const rangeStart of [blankLineBeforeTable, blankLineAfterTable]) {
      await expect(
        prettier.format(rangedMarkdown, {
          parser: 'markdown',
          plugins: [plugin],
          rangeEnd: rangeStart,
          rangeStart,
        }),
      ).resolves.toBe(rangedMarkdown);
    }
  });

  for (const rangeEndOption of ['omitted', 'infinity'] as const) {
    test(`given rangeEnd ${rangeEndOption} and a table range through EOF, when formatting, then normalizes only the selected range`, async () => {
      const beforeTable = [
        '| Before  | Table       |',
        '| ------- | ----------- |',
        '| keep    | as written  |',
      ].join('\n');
      const selectedTable = [
        '| Pick  | Value       |',
        '| ----- | ----------- |',
        '| yes   | 1           |',
      ].join('\n');
      const rangedMarkdown = [beforeTable, '', selectedTable, ''].join('\n');
      const rangeStart = rangedMarkdown.indexOf('| Pick');
      const rangeOptions =
        rangeEndOption === 'infinity'
          ? {
              rangeEnd: Number.POSITIVE_INFINITY,
              rangeStart,
            }
          : {
              rangeStart,
            };

      await expect(
        prettier.format(rangedMarkdown, {
          parser: 'markdown',
          plugins: [plugin],
          ...rangeOptions,
        }),
      ).resolves.toBe(
        [
          beforeTable,
          '',
          '| Pick | Value |',
          '| --- | --- |',
          '| yes | 1 |',
          '',
        ].join('\n'),
      );
    });
  }

  test('given parser preprocessing receives infinite rangeEnd, when mapping offsets, then it keeps the range ending at EOF', () => {
    const script = `
      import plugin from './dist/index.js';

      const beforeTable = [
        '| Before  | Table       |',
        '| ------- | ----------- |',
        '| keep    | as written  |',
      ].join('\\n');
      const selectedTable = [
        '| Pick  | Value       |',
        '| ----- | ----------- |',
        '| yes   | 1           |',
      ].join('\\n');
      const markdown = [beforeTable, '', selectedTable, ''].join('\\n');
      const options = {
        locEnd: () => 0,
        locStart: () => 0,
        originalText: markdown,
        parser: 'markdown',
        plugins: [plugin],
        rangeEnd: Number.POSITIVE_INFINITY,
        rangeStart: markdown.indexOf('| Pick'),
      };
      const parser = plugin.parsers.markdown;
      const normalized = parser.preprocess(markdown, options);
      const expected = [
        beforeTable,
        '',
        '| Pick | Value |',
        '| --- | --- |',
        '| yes | 1 |',
        '',
      ].join('\\n');

      if (normalized !== expected) {
        console.error(normalized);
        process.exit(1);
      }

      if (options.rangeEnd !== normalized.length) {
        console.error(options.rangeEnd);
        process.exit(1);
      }
    `;

    const result = runNodeCli(['--input-type=module', '--eval', script]);

    expectCliStatus(result, 0);
    expect(result.stderr).toBe('');
  });

  test('given parser preprocessing receives invalid ranges, when normalizing, then it throws before early range checks', () => {
    const markdown = [
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');
    const parser = plugin.parsers?.markdown;

    if (parser?.preprocess === undefined) {
      throw new Error('Expected the Markdown parser preprocess hook to exist.');
    }

    const preprocess: unknown = parser.preprocess;

    if (!isUnknownFunction(preprocess)) {
      throw new Error(
        'Expected the Markdown parser preprocess hook to be callable.',
      );
    }

    expect(() =>
      preprocess(markdown, {
        locEnd: () => 0,
        locStart: () => 0,
        originalText: markdown,
        parser: 'markdown',
        plugins: [plugin],
        rangeStart: -1,
      }),
    ).toThrow(
      `Invalid rangeStart "-1" — expected an integer between 0 and ${String(
        markdown.length,
      )}.`,
    );

    expect(() =>
      preprocess(markdown, {
        locEnd: () => 0,
        locStart: () => 0,
        originalText: markdown,
        parser: 'markdown',
        plugins: [plugin],
        rangeEnd: markdown.length + 1,
      }),
    ).toThrow(
      `Invalid rangeEnd "${String(
        markdown.length + 1,
      )}" — expected an integer between 0 and ${String(markdown.length)}.`,
    );
  });

  test('given parser preprocessing changes range state, when root printing uses the same options object, then the mapped source is available', async () => {
    const beforeTable = [
      '| Before  | Table       |',
      '| ------- | ----------- |',
      '| keep    | as written  |',
    ].join('\n');
    const selectedTable = [
      '| Pick  | Value       |',
      '| ----- | ----------- |',
      '| yes   | 1           |',
    ].join('\n');
    const markdown = [beforeTable, '', selectedTable, ''].join('\n');
    const expected = [
      beforeTable,
      '',
      '| Pick | Value |',
      '| --- | --- |',
      '| yes | 1 |',
      '',
    ].join('\n');
    const options: {
      cursorOffset: number;
      locEnd: () => number;
      locStart: () => number;
      originalText: string;
      rangeEnd: number;
      rangeStart: number;
    } & prettier.Options = {
      cursorOffset: markdown.indexOf('yes') + 'yes'.length,
      locEnd: () => 0,
      locStart: () => 0,
      originalText: markdown,
      parser: 'markdown',
      plugins: [plugin],
      rangeEnd: markdown.length,
      rangeStart: markdown.indexOf('| Pick'),
    };
    const parser = plugin.parsers?.markdown;

    if (parser?.preprocess === undefined) {
      throw new Error('Expected the Markdown parser preprocess hook to exist.');
    }

    const preprocess: unknown = parser.preprocess;

    if (!isUnknownFunction(preprocess)) {
      throw new Error(
        'Expected the Markdown parser preprocess hook to be callable.',
      );
    }

    const preprocessed = preprocess(markdown, options);

    if (typeof preprocessed !== 'string') {
      throw new Error(
        'Expected the Markdown parser preprocess hook to return text.',
      );
    }

    expect(preprocessed).toBe(expected);
    expect(options.rangeStart).toBe(expected.indexOf('| Pick'));
    expect(options.rangeEnd).toBe(expected.length);
    expect(options.cursorOffset).toBe(expected.indexOf('yes') + 'yes'.length);

    Reflect.set(options, 'originalText', undefined);

    const printed = printRootMarkdownDocWithoutOriginalText(expected, options);
    const result = await getPrettierDebugApi().printDocToString(
      printed,
      options,
    );

    expect(result.formatted).toBe(expected);
  });

  test('given one options object is reused after a parser-printer handoff, when the source text changes, then stale source is ignored', async () => {
    const beforeTable = [
      '| Before  | Table       |',
      '| ------- | ----------- |',
      '| keep    | as written  |',
    ].join('\n');
    const selectedTable = [
      '| Pick  | Value       |',
      '| ----- | ----------- |',
      '| yes   | 1           |',
    ].join('\n');
    const firstMarkdown = [beforeTable, '', selectedTable, ''].join('\n');
    const firstExpected = [
      beforeTable,
      '',
      '| Pick | Value |',
      '| --- | --- |',
      '| yes | 1 |',
      '',
    ].join('\n');
    const options: {
      locEnd: () => number;
      locStart: () => number;
      originalText: string;
      rangeEnd: number;
      rangeStart: number;
    } & prettier.Options = {
      locEnd: () => 0,
      locStart: () => 0,
      originalText: firstMarkdown,
      parser: 'markdown',
      plugins: [plugin],
      rangeEnd: firstMarkdown.length,
      rangeStart: firstMarkdown.indexOf('| Pick'),
    };
    const parser = plugin.parsers?.markdown;

    if (parser?.preprocess === undefined) {
      throw new Error('Expected the Markdown parser preprocess hook to exist.');
    }

    const preprocess: unknown = parser.preprocess;

    if (!isUnknownFunction(preprocess)) {
      throw new Error(
        'Expected the Markdown parser preprocess hook to be callable.',
      );
    }

    const preprocessed = preprocess(firstMarkdown, options);

    if (typeof preprocessed !== 'string') {
      throw new Error(
        'Expected the Markdown parser preprocess hook to return text.',
      );
    }

    expect(preprocessed).toBe(firstExpected);

    const firstPrinted = printRootMarkdownDocWithoutOriginalText(
      firstExpected,
      options,
    );
    const firstResult = await getPrettierDebugApi().printDocToString(
      firstPrinted,
      options,
    );

    expect(firstResult.formatted).toBe(firstExpected);

    const secondMarkdown = [
      '| Longer Header  | Wider Role      |',
      '| -------------- | --------------- |',
      '| Different Name | Different Value With Extra Text That Makes This Source Longer |',
      '',
    ].join('\n');
    const secondExpected = [
      '| Longer Header | Wider Role |',
      '| --- | --- |',
      '| Different Name | Different Value With Extra Text That Makes This Source Longer |',
      '',
    ].join('\n');

    options.originalText = secondMarkdown;
    options.rangeEnd = secondMarkdown.length;
    options.rangeStart = 0;

    const secondPrinted = printRootMarkdownDocWithoutOriginalText(
      secondMarkdown,
      options,
    );
    const secondResult = await getPrettierDebugApi().printDocToString(
      secondPrinted,
      options,
    );

    expect(secondResult.formatted).toBe(secondExpected);
  });

  test('given selected text before a table shrinks during printing, when printing a range doc, then range normalization stays in formatted coordinates', async () => {
    const beforeTable = [
      '| Before | Table      |',
      '| ------ | ---------- |',
      '| keep   | as written |',
    ].join('\n');
    const selectedTable = [
      '| Pick  | Value       |',
      '| ----- | ----------- |',
      '| yes   | 1           |',
    ].join('\n');
    const rangedMarkdown = [
      beforeTable,
      '',
      '##       Heading before selected table',
      '',
      selectedTable,
      '',
    ].join('\n');
    const rangeStart = rangedMarkdown.indexOf('##');
    const rangeEnd = rangedMarkdown.length;
    const options = {
      parser: 'markdown',
      plugins: [plugin],
      rangeEnd,
      rangeStart,
    } satisfies prettier.Options;
    const debugApi = getPrettierDebugApi();
    const doc = await debugApi.printToDoc(rangedMarkdown, options);
    const result = await debugApi.printDocToString(doc, options);

    expect(result.formatted).toBe(
      [
        beforeTable,
        '',
        '## Heading before selected table',
        '',
        '| Pick | Value |',
        '| --- | --- |',
        '| yes | 1 |',
        '',
      ].join('\n'),
    );
  });

  test('given printed headings insert lines before a selected table, when printing a range doc, then the selected table still collapses', async () => {
    const selectedTable = [
      '| Pick  | Value       |',
      '| ----- | ----------- |',
      '| yes   | 1           |',
    ].join('\n');
    const afterTable = [
      '| After | Table      |',
      '| ----- | ---------- |',
      '| keep  | as written |',
    ].join('\n');
    const rangedMarkdown = [
      '# One',
      '# Two',
      '# Three',
      '# Four',
      selectedTable,
      '',
      afterTable,
      '',
    ].join('\n');
    const rangeStart = 0;
    const rangeEnd = rangedMarkdown.indexOf('| After') - 1;
    const options = {
      parser: 'markdown',
      plugins: [plugin],
      rangeEnd,
      rangeStart,
    } satisfies prettier.Options;
    const debugApi = getPrettierDebugApi();
    const doc = await debugApi.printToDoc(rangedMarkdown, options);
    const result = await debugApi.printDocToString(doc, options);

    expect(result.formatted).toBe(
      [
        '# One',
        '',
        '# Two',
        '',
        '# Three',
        '',
        '# Four',
        '',
        '| Pick | Value |',
        '| --- | --- |',
        '| yes | 1 |',
        '',
        afterTable,
        '',
      ].join('\n'),
    );
  });

  test('given debug printing without originalText and no range, when printing, then it falls back to printed Markdown', async () => {
    const printOptions = {
      parser: 'markdown',
      plugins: [plugin],
    } satisfies prettier.Options;
    const printed = printRootMarkdownDocWithoutOriginalText(
      unnormalizedMarkdown,
      printOptions,
    );
    const result = await getPrettierDebugApi().printDocToString(
      printed,
      printOptions,
    );

    expect(result.formatted).toBe(markdown);
  });

  test('given debug printing has no table node, when printed text has pipes, then it skips the adapter rewrite', async () => {
    const printOptions = {
      parser: 'markdown',
      plugins: [plugin],
    } satisfies prettier.Options;
    const printed = printRootMarkdownDocWithoutOriginalText(
      unnormalizedMarkdown,
      printOptions,
      {
        children: [{ type: 'paragraph' }],
        type: 'root',
      },
    );
    const result = await getPrettierDebugApi().printDocToString(
      printed,
      printOptions,
    );

    expect(result.formatted).toBe(unnormalizedMarkdown);
  });

  test('given debug range printing without originalText, when printing, then it explains that range mapping needs source text', () => {
    const printOptions = {
      parser: 'markdown',
      plugins: [plugin],
      rangeEnd: unnormalizedMarkdown.length,
      rangeStart: unnormalizedMarkdown.indexOf('Davey'),
    } satisfies prettier.Options;

    expect(() =>
      printRootMarkdownDocWithoutOriginalText(
        unnormalizedMarkdown,
        printOptions,
      ),
    ).toThrow(
      'Cannot map Markdown table range because Prettier did not provide originalText. Format the full document or pass originalText in the parser options.',
    );
  });

  test('given public range formatting and a selected table shrinks, when formatting, then neighboring tables stay unchanged', async () => {
    const beforeTable = [
      '| Before long | X   |',
      '| ----------- | --- |',
      '| keep        | as  |',
    ].join('\n');
    const selectedTable = [
      '| Pick  | Value       |',
      '| ----- | ----------- |',
      '| yes   | 1           |',
    ].join('\n');
    const afterTable = [
      '| After long | Y   |',
      '| ---------- | --- |',
      '| keep       | as  |',
    ].join('\n');
    const rangedMarkdown = [
      beforeTable,
      '',
      selectedTable,
      '',
      afterTable,
      '',
    ].join('\n');
    const rangeStart = rangedMarkdown.indexOf('| Pick');
    const rangeEnd = rangedMarkdown.indexOf('| After') - 1;

    await expect(
      prettier.format(rangedMarkdown, {
        parser: 'markdown',
        plugins: [plugin],
        rangeEnd,
        rangeStart,
      }),
    ).resolves.toBe(
      [
        beforeTable,
        '',
        '| Pick | Value |',
        '| --- | --- |',
        '| yes | 1 |',
        '',
        afterTable,
        '',
      ].join('\n'),
    );
  });

  test('given a range starts inside fenced code before a table, when formatting, then protected code stays unchanged and the table collapses', async () => {
    const fencedCode = [
      '```md',
      '| Keep  | Fence |',
      '| ----- | ----- |',
      '| this  | text  |',
      '```',
    ].join('\n');
    const selectedTable = [
      '| Pick  | Value       |',
      '| ----- | ----------- |',
      '| yes   | 1           |',
    ].join('\n');
    const afterTable = [
      '| After   | Table       |',
      '| ------- | ----------- |',
      '| keep    | as written  |',
    ].join('\n');
    const rangedMarkdown = [
      fencedCode,
      '',
      selectedTable,
      '',
      afterTable,
      '',
    ].join('\n');
    const rangeStart = rangedMarkdown.indexOf('Keep');
    const rangeEnd = rangedMarkdown.indexOf('| After') - 1;

    await expect(
      prettier.format(rangedMarkdown, {
        parser: 'markdown',
        plugins: [plugin],
        rangeEnd,
        rangeStart,
      }),
    ).resolves.toBe(
      [
        fencedCode,
        '',
        '| Pick | Value |',
        '| --- | --- |',
        '| yes | 1 |',
        '',
        afterTable,
        '',
      ].join('\n'),
    );
  });

  test('given a range ends inside an HTML comment after a table, when formatting, then the table collapses and the comment stays unchanged', async () => {
    const selectedTable = [
      '| Pick  | Value       |',
      '| ----- | ----------- |',
      '| yes   | 1           |',
    ].join('\n');
    const htmlComment = [
      '<!--',
      '| Keep  | Comment |',
      '| ----- | ------- |',
      '| this  | text    |',
      '-->',
    ].join('\n');
    const afterTable = [
      '| After   | Table       |',
      '| ------- | ----------- |',
      '| keep    | as written  |',
    ].join('\n');
    const rangedMarkdown = [
      selectedTable,
      '',
      htmlComment,
      '',
      afterTable,
      '',
    ].join('\n');
    const rangeStart = rangedMarkdown.indexOf('| Pick');
    const rangeEnd = rangedMarkdown.indexOf('text') + 'text'.length;

    await expect(
      prettier.format(rangedMarkdown, {
        parser: 'markdown',
        plugins: [plugin],
        rangeEnd,
        rangeStart,
      }),
    ).resolves.toBe(
      [
        '| Pick | Value |',
        '| --- | --- |',
        '| yes | 1 |',
        '',
        htmlComment,
        '',
        afterTable,
        '',
      ].join('\n'),
    );
  });

  test('given a range starts inside MDX ESM before a table, when formatting MDX, then protected ESM stays unchanged and the table collapses', async () => {
    const mdxEsm = [
      'export const table = `',
      '| Keep  | ESM  |',
      '| ----- | ---- |',
      '| this  | text |',
      '`;',
    ].join('\n');
    const selectedTable = [
      '| Pick  | Value       |',
      '| ----- | ----------- |',
      '| yes   | 1           |',
    ].join('\n');
    const afterTable = [
      '| After   | Table       |',
      '| ------- | ----------- |',
      '| keep    | as written  |',
    ].join('\n');
    const rangedMarkdown = [mdxEsm, '', selectedTable, '', afterTable, ''].join(
      '\n',
    );
    const rangeStart = rangedMarkdown.indexOf('Keep');
    const rangeEnd = rangedMarkdown.indexOf('| After') - 1;

    await expect(
      prettier.format(rangedMarkdown, {
        parser: 'mdx',
        plugins: [plugin],
        rangeEnd,
        rangeStart,
      }),
    ).resolves.toBe(
      [
        mdxEsm,
        '',
        '| Pick | Value |',
        '| --- | --- |',
        '| yes | 1 |',
        '',
        afterTable,
        '',
      ].join('\n'),
    );
  });

  for (const rangeStyleCase of RANGE_TABLE_STYLE_CASES) {
    test(`given ${rangeStyleCase.label} and a range intersecting one table, when formatting, then leaves other tables unchanged`, async () => {
      const beforeTable = [
        '| Before  | Table       |',
        '| ------- | ----------- |',
        '| keep    | as written  |',
      ].join('\n');
      const selectedTable = [
        '| Pick  | Value       |',
        '| ----- | ----------- |',
        '| yes   | 1           |',
      ].join('\n');
      const afterTable = [
        '| After   | Table       |',
        '| ------- | ----------- |',
        '| keep    | as written  |',
      ].join('\n');
      const rangedMarkdown = [
        beforeTable,
        '',
        selectedTable,
        '',
        afterTable,
        '',
      ].join('\n');
      const rangeStart = rangedMarkdown.indexOf('Pick');
      const rangeEnd = rangeStart + 'Pick'.length;

      await expect(
        prettier.format(
          rangedMarkdown,
          withOptionalMarkdownTableStyle(
            {
              parser: 'markdown',
              plugins: [plugin],
              rangeEnd,
              rangeStart,
            },
            rangeStyleCase.markdownTableStyle,
          ),
        ),
      ).resolves.toBe(
        [
          beforeTable,
          '',
          rangeStyleCase.expectedSelectedTable,
          '',
          afterTable,
          '',
        ].join('\n'),
      );
    });
  }

  test('given a selected table shrinks during preprocessing, when formatting a range, then neighboring tables stay unchanged', async () => {
    const padding = ' '.repeat(80);
    const beforeTable = [
      '| Before long | X   |',
      '| ----------- | --- |',
      '| keep        | as  |',
    ].join('\n');
    const selectedTable = [
      `| Pick${padding}| Value${padding}|`,
      `| ---${padding}| ---${padding}|`,
      `| yes${padding}| 1${padding}|`,
    ].join('\n');
    const afterTable = [
      '| After long | Y   |',
      '| ---------- | --- |',
      '| keep       | as  |',
    ].join('\n');
    const rangedMarkdown = [
      beforeTable,
      '',
      selectedTable,
      '',
      afterTable,
      '',
    ].join('\n');
    const rangeStart = rangedMarkdown.indexOf('| Pick');
    const rangeEnd = rangedMarkdown.indexOf('| After') - 1;

    await expect(
      prettier.format(rangedMarkdown, {
        parser: 'markdown',
        plugins: [plugin],
        rangeEnd,
        rangeStart,
      }),
    ).resolves.toBe(
      [
        beforeTable,
        '',
        '| Pick | Value |',
        '| --- | --- |',
        '| yes | 1 |',
        '',
        afterTable,
        '',
      ].join('\n'),
    );
  });

  test('given compact style and a range inside a wide table cell, when formatting, then only that table is compacted', async () => {
    const padding = ' '.repeat(120);
    const beforeTable = [
      '| Before long | X   |',
      '| ----------- | --- |',
      '| keep        | as  |',
    ].join('\n');
    const selectedTable = [
      `| Name${padding}| Role${padding}|`,
      `| ---${padding}| ---${padding}|`,
      `| Davey cell text${padding}| Builder${padding}|`,
    ].join('\n');
    const afterTable = [
      '| After long | Y   |',
      '| ---------- | --- |',
      '| keep       | as  |',
    ].join('\n');
    const rangedMarkdown = [
      beforeTable,
      '',
      selectedTable,
      '',
      afterTable,
      '',
    ].join('\n');
    const rangeStart = rangedMarkdown.indexOf('cell text');
    const rangeEnd = rangeStart + 'cell'.length;

    await expect(
      prettier.format(rangedMarkdown, {
        markdownTableStyle: 'compact',
        parser: 'markdown',
        plugins: [plugin],
        rangeEnd,
        rangeStart,
      }),
    ).resolves.toBe(
      [
        beforeTable,
        '',
        '|Name|Role|',
        '|---|---|',
        '|Davey cell text|Builder|',
        '',
        afterTable,
        '',
      ].join('\n'),
    );
  });

  test('given compact style and a range inside a repaired escaped-pipe cell, when formatting, then only that table is compacted', async () => {
    const beforeTable = [
      '| Before  | Table       |',
      '| ------- | ----------- |',
      '| keep    | as written  |',
    ].join('\n');
    const selectedTable = [
      '| Value                | Note        |',
      '| -------------------- | ----------- |',
      '| foo\\          |          bar | kept |',
    ].join('\n');
    const afterTable = [
      '| After   | Table       |',
      '| ------- | ----------- |',
      '| keep    | as written  |',
    ].join('\n');
    const rangedMarkdown = [
      beforeTable,
      '',
      selectedTable,
      '',
      afterTable,
      '',
    ].join('\n');
    const rangeStart = rangedMarkdown.indexOf('bar');
    const rangeEnd = rangeStart + 'bar'.length;

    await expect(
      prettier.format(rangedMarkdown, {
        markdownTableStyle: 'compact',
        parser: 'markdown',
        plugins: [plugin],
        rangeEnd,
        rangeStart,
      }),
    ).resolves.toBe(
      [
        beforeTable,
        '',
        '|Value|Note|',
        '|---|---|',
        '|foo\\|bar|kept|',
        '',
        afterTable,
        '',
      ].join('\n'),
    );
  });

  test('given a range inside a wide table, when formatting, then leaves the following paragraph outside the range', async () => {
    const padding = ' '.repeat(120);
    const headerLine = `| Name${padding}| Role${padding}|`;
    const separatorLine = `| ---${padding}| ---${padding}|`;
    const rowLine = `| Davey${padding}| Builder${padding}|`;
    const rangedMarkdown = [
      headerLine,
      separatorLine,
      rowLine,
      '',
      'Target    paragraph    keeps    distinctive    spacing.',
      '',
    ].join('\n');
    const rangeStart = rangedMarkdown.indexOf('Davey');
    const rangeEnd = rangeStart + 'Davey'.length;

    await expect(
      prettier.format(rangedMarkdown, {
        parser: 'markdown',
        plugins: [plugin],
        rangeEnd,
        rangeStart,
      }),
    ).resolves.toBe(
      [
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '',
        'Target    paragraph    keeps    distinctive    spacing.',
        '',
      ].join('\n'),
    );
  });

  test('given prettier style and a table range, when formatting, then matches Prettier Markdown output', async () => {
    const rangedMarkdown = [
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
    ].join('\n');
    const rangeStart = rangedMarkdown.indexOf('| Name');
    const rangeEnd =
      rangedMarkdown.indexOf('| Davey') + '| Davey | Builder     |'.length;
    const options = {
      parser: 'markdown',
      plugins: [prettierMarkdownPlugin],
      rangeEnd,
      rangeStart,
    } satisfies prettier.Options;

    const prettierOutput = await prettier.format(rangedMarkdown, options);
    const pluginOutput = await prettier.format(rangedMarkdown, {
      markdownTableStyle: 'prettier',
      parser: 'markdown',
      plugins: [plugin],
      rangeEnd,
      rangeStart,
    });

    expect(pluginOutput).toBe(prettierOutput);
  });

  test('given a cursor before a table, when formatting with cursor, then keeps the cursor by the same text', async () => {
    const cursorMarkdown = [
      'Intro text',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
    ].join('\n');
    const cursorOffset = cursorMarkdown.indexOf('Intro') + 'Intro'.length;
    const result = await prettier.formatWithCursor(cursorMarkdown, {
      cursorOffset,
      parser: 'markdown',
      plugins: [plugin],
    });

    expect(result.cursorOffset).toBe(
      result.formatted.indexOf('Intro') + 'Intro'.length,
    );
  });

  test('given a cursor after a table, when formatting with cursor, then keeps the cursor by the same text', async () => {
    const cursorMarkdown = [
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
      'Target paragraph   with   spaces.',
      '',
    ].join('\n');
    const cursorOffset = cursorMarkdown.indexOf('Target') + 'Target'.length;
    const result = await prettier.formatWithCursor(cursorMarkdown, {
      cursorOffset,
      parser: 'markdown',
      plugins: [plugin],
    });

    expect(result.cursorOffset).toBe(
      result.formatted.indexOf('Target') + 'Target'.length,
    );
  });

  test('given CRLF line endings and a cursor inside a table, when formatting with cursor, then keeps the cursor by the same cell text', async () => {
    const cursorMarkdown = [
      '| Name                 | Role        |',
      '| -------------------- | ----------- |',
      '| Davey                | Builder     |',
      '',
    ].join('\r\n');
    const cursorOffset = cursorMarkdown.indexOf('Builder') + 'Buil'.length;
    const result = await prettier.formatWithCursor(cursorMarkdown, {
      cursorOffset,
      endOfLine: 'crlf',
      parser: 'markdown',
      plugins: [plugin],
    });

    expect(result.cursorOffset).toBe(
      result.formatted.indexOf('Builder') + 'Buil'.length,
    );
    expect(result.formatted.slice(result.cursorOffset)).toContain('der');
  });

  test('given a cursor between CRLF characters, when formatting with cursor, then maps it to the next line start', async () => {
    const cursorMarkdown = [
      '| Name                 | Role        |',
      '| -------------------- | ----------- |',
      '| Davey                | Builder     |',
      '',
    ].join('\r\n');
    const cursorOffset = cursorMarkdown.indexOf('\r\n') + 1;
    const result = await prettier.formatWithCursor(cursorMarkdown, {
      cursorOffset,
      endOfLine: 'crlf',
      parser: 'markdown',
      plugins: [plugin],
    });

    expect(result.cursorOffset).toBe(result.formatted.indexOf('| ---'));
    expect(
      result.formatted.slice(result.cursorOffset).startsWith('| ---'),
    ).toBe(true);
  });

  test('given CRLF line endings and a cursor after a table, when formatting with cursor, then keeps the cursor by the same text', async () => {
    const cursorMarkdown = [
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
      'Target paragraph   with   spaces.',
      '',
    ].join('\r\n');
    const cursorOffset = cursorMarkdown.indexOf('Target') + 'Target'.length;
    const result = await prettier.formatWithCursor(cursorMarkdown, {
      cursorOffset,
      endOfLine: 'crlf',
      parser: 'markdown',
      plugins: [plugin],
    });

    expect(result.cursorOffset).toBe(
      result.formatted.indexOf('Target') + 'Target'.length,
    );
    expect(result.formatted.slice(result.cursorOffset)).toContain(' paragraph');
  });

  test('given CR-only line endings and a cursor inside a table, when formatting with cursor, then keeps the cursor by the same cell text', async () => {
    const cursorMarkdown = [
      '| Name                 | Role        |',
      '| -------------------- | ----------- |',
      '| Davey                | Builder     |',
      '',
    ].join('\r');
    const cursorOffset = cursorMarkdown.indexOf('Builder') + 'Buil'.length;
    const result = await prettier.formatWithCursor(cursorMarkdown, {
      cursorOffset,
      endOfLine: 'cr',
      parser: 'markdown',
      plugins: [plugin],
    });

    expect(result.cursorOffset).toBe(
      result.formatted.indexOf('Builder') + 'Buil'.length,
    );
    expect(result.formatted.slice(result.cursorOffset)).toContain('der');
  });

  test('given a cursor inside a header cell, when formatting with cursor, then keeps the cursor by the same header text', async () => {
    await expectCursorByText({
      cursorText: 'Role',
      markdown: [
        '| Name                 | Role        |',
        '| -------------------- | ----------- |',
        '| Davey                | Builder     |',
        '',
      ].join('\n'),
      textBeforeCursor: 'Ro',
    });
  });

  test('given a cursor inside a body cell, when formatting with cursor, then keeps the cursor by the same body text', async () => {
    await expectCursorByText({
      cursorText: 'Builder',
      markdown: [
        '| Name                 | Role        |',
        '| -------------------- | ----------- |',
        '| Davey                | Builder     |',
        '',
      ].join('\n'),
      textBeforeCursor: 'Buil',
    });
  });

  test('given a cursor inside a code-span cell, when formatting with cursor, then keeps the cursor by the same code text', async () => {
    await expectCursorByText({
      cursorText: 'bar',
      markdown: [
        '| Pattern              | Note        |',
        '| -------------------- | ----------- |',
        '| `foo          |          bar` | kept |',
        '',
      ].join('\n'),
      textBeforeCursor: 'ba',
    });
  });

  test('given a cursor inside an escaped-pipe cell, when formatting with cursor, then keeps the cursor by the same repaired cell text', async () => {
    await expectCursorByText({
      cursorText: 'bar',
      markdown: [
        '| Value                | Note        |',
        '| -------------------- | ----------- |',
        '| foo\\          |          bar | kept |',
        '',
      ].join('\n'),
      textBeforeCursor: 'ba',
    });
  });

  test('given compact style and a cursor inside an escaped-pipe cell, when formatting with cursor, then keeps the cursor by the same repaired cell text', async () => {
    await expectCursorByText({
      cursorText: 'bar',
      markdown: [
        '| Value                | Note        |',
        '| -------------------- | ----------- |',
        '| foo\\          |          bar | kept |',
        '',
      ].join('\n'),
      options: {
        markdownTableStyle: 'compact',
      },
      textBeforeCursor: 'ba',
    });
  });

  test('given compact style and a cursor inside a table cell, when formatting with cursor, then keeps the cursor by the same compacted text', async () => {
    await expectCursorByText({
      cursorText: 'Builder',
      markdown: [
        '| Name                 | Role        |',
        '| -------------------- | ----------- |',
        '| Davey                | Builder     |',
        '',
      ].join('\n'),
      options: {
        markdownTableStyle: 'compact',
      },
      textBeforeCursor: 'Buil',
    });
  });

  test('given duplicate cell text around a cursor, when formatting the whole document with cursor, then keeps the cursor on the same occurrence', async () => {
    await expectCursorByOccurrence({
      cursorText: 'Builder',
      markdown: [
        'Builder appears before the table.',
        '',
        '| Name                 | Role        |',
        '| -------------------- | ----------- |',
        '| Alpha                | Builder     |',
        '| Davey                | Builder     |',
        '| Zed                  | Builder     |',
        '',
        'Builder appears after the table.',
        '',
      ].join('\n'),
      occurrenceIndex: 2,
      textBeforeCursor: 'Buil',
    });
  });

  test('given duplicate cell text around a cursor, when range formatting with cursor, then keeps the cursor on the same occurrence', async () => {
    const markdown = [
      'Builder appears before the table.',
      '',
      '| Name                 | Role        |',
      '| -------------------- | ----------- |',
      '| Alpha                | Builder     |',
      '| Davey                | Builder     |',
      '| Zed                  | Builder     |',
      '',
      'Builder appears after the table.',
      '',
    ].join('\n');
    const rangeStart = markdown.indexOf('| Name');
    const rangeEnd = markdown.indexOf('Builder appears after');

    await expectCursorByOccurrence({
      cursorText: 'Builder',
      markdown,
      occurrenceIndex: 2,
      options: {
        rangeEnd,
        rangeStart,
      },
      textBeforeCursor: 'Buil',
    });
  });

  test('given duplicate cell text around a cursor, when compact formatting with cursor, then keeps the cursor on the same occurrence', async () => {
    await expectCursorByOccurrence({
      cursorText: 'Builder',
      markdown: [
        'Builder appears before the table.',
        '',
        '| Name                 | Role        |',
        '| -------------------- | ----------- |',
        '| Alpha                | Builder     |',
        '| Davey                | Builder     |',
        '| Zed                  | Builder     |',
        '',
        'Builder appears after the table.',
        '',
      ].join('\n'),
      occurrenceIndex: 2,
      options: {
        markdownTableStyle: 'compact',
      },
      textBeforeCursor: 'Buil',
    });
  });

  test('given compact style and duplicate cell text around a range cursor, when formatting, then keeps the cursor on the same occurrence', async () => {
    const markdown = [
      'Builder appears before the table.',
      '',
      '| Name                 | Role        |',
      '| -------------------- | ----------- |',
      '| Alpha                | Builder     |',
      '| Davey                | Builder     |',
      '| Zed                  | Builder     |',
      '',
      'Builder appears after the table.',
      '',
    ].join('\n');
    const rangeStart = markdown.indexOf('| Name');
    const rangeEnd = markdown.indexOf('Builder appears after');

    await expectCursorByOccurrence({
      cursorText: 'Builder',
      markdown,
      occurrenceIndex: 2,
      options: {
        markdownTableStyle: 'compact',
        rangeEnd,
        rangeStart,
      },
      textBeforeCursor: 'Buil',
    });
  });

  test('given duplicate repaired escaped-pipe text around a cursor, when formatting with cursor, then keeps the cursor on the same occurrence', async () => {
    await expectCursorByOccurrence({
      cursorText: 'bar',
      markdown: [
        'bar appears before the table.',
        '',
        '| Value                | Note        |',
        '| -------------------- | ----------- |',
        '| first bar            | kept        |',
        '| foo\\          |          bar | kept |',
        '| last bar             | kept        |',
        '',
        'bar appears after the table.',
        '',
      ].join('\n'),
      occurrenceIndex: 2,
      textBeforeCursor: 'ba',
    });
  });

  test('given compact style and duplicate repaired escaped-pipe text around a cursor, when formatting, then keeps the cursor on the same occurrence', async () => {
    await expectCursorByOccurrence({
      cursorText: 'bar',
      markdown: [
        'bar appears before the table.',
        '',
        '| Value                | Note        |',
        '| -------------------- | ----------- |',
        '| first bar            | kept        |',
        '| foo\\          |          bar | kept |',
        '| last bar             | kept        |',
        '',
        'bar appears after the table.',
        '',
      ].join('\n'),
      occurrenceIndex: 2,
      options: {
        markdownTableStyle: 'compact',
      },
      textBeforeCursor: 'ba',
    });
  });

  test('given duplicate Unicode cell text around a cursor, when formatting with cursor, then keeps the cursor after the same combining sequence', async () => {
    await expectCursorByOccurrence({
      cursorText: 'éclair 😀',
      markdown: [
        'éclair 😀 appears before the table.',
        '',
        '| Name                 | Note        |',
        '| -------------------- | ----------- |',
        '| Alpha                | éclair 😀  |',
        '| Davey                | éclair 😀  |',
        '| Zed                  | éclair 😀  |',
        '',
        'éclair 😀 appears after the table.',
        '',
      ].join('\n'),
      occurrenceIndex: 2,
      textBeforeCursor: 'é',
    });
  });

  test('given a cursor inside an emoji surrogate pair, when formatting with cursor, then keeps the cursor inside the same emoji', async () => {
    const cursorMarkdown = [
      '| Name                 | Note           |',
      '| -------------------- | -------------- |',
      '| Davey                | emoji 😀 target |',
      '',
    ].join('\n');
    const emojiIndex = cursorMarkdown.indexOf('😀');
    const cursorOffset = emojiIndex + 1;
    const result = await prettier.formatWithCursor(cursorMarkdown, {
      cursorOffset,
      parser: 'markdown',
      plugins: [plugin],
    });
    const formattedEmojiIndex = result.formatted.indexOf('😀');

    expect(result.cursorOffset).toBe(formattedEmojiIndex + 1);
    expect(result.formatted.charCodeAt(result.cursorOffset)).toBe(0xde00);
    expect(result.formatted.slice(result.cursorOffset + 1)).toContain(
      ' target',
    );
  });

  test('given a cursor range inside a very wide repaired row, when formatting with cursor, then mapping stays fast', async () => {
    const prefix = 'x'.repeat(20_000);
    const cursorMarkdown = [
      'Intro text',
      '',
      '| Value | Note |',
      '| --- | --- |',
      `| ${prefix}\\          |          cursor target | kept |`,
      '',
      'Outro text',
      '',
    ].join('\n');
    const cursorOffset =
      cursorMarkdown.indexOf('cursor target') + 'cursor'.length;
    const rangeStart = cursorMarkdown.indexOf('cursor target');
    const rangeEnd = rangeStart + 'cursor target'.length;
    const start = IS_STRICT_PERFORMANCE_TEST ? performance.now() : undefined;
    const result = await prettier.formatWithCursor(cursorMarkdown, {
      cursorOffset,
      parser: 'markdown',
      plugins: [plugin],
      rangeEnd,
      rangeStart,
    });

    expect(result.cursorOffset).toBe(
      result.formatted.indexOf('cursor target') + 'cursor'.length,
    );
    expect(result.formatted.slice(result.cursorOffset)).toContain(' target');

    if (start !== undefined) {
      expectPluginDurationBelow(
        performance.now() - start,
        WIDE_CURSOR_MAPPING_TIMEOUT_MS,
        cursorMarkdown.length,
        'cursor range formatting',
      );
    }
  });

  test('given a cursor inside a ranged wide table, when formatting with cursor, then keeps the cursor by the same cell text', async () => {
    const padding = ' '.repeat(80);
    const headerLine = `| Name${padding}| Role${padding}|`;
    const separatorLine = `| ---${padding}| ---${padding}|`;
    const rowLine = `| Davey cell text${padding}| Builder${padding}|`;
    const cursorMarkdown = [
      'Intro text',
      '',
      headerLine,
      separatorLine,
      rowLine,
      '',
      'Target    paragraph    keeps    distinctive    spacing.',
      '',
    ].join('\n');
    const rangeStart = cursorMarkdown.indexOf('Davey');
    const rangeEnd = rangeStart + 'Davey cell text'.length;
    const cursorOffset = cursorMarkdown.indexOf('cell text') + 'cell'.length;
    const result = await prettier.formatWithCursor(cursorMarkdown, {
      cursorOffset,
      parser: 'markdown',
      plugins: [plugin],
      rangeEnd,
      rangeStart,
    });

    expect(result.cursorOffset).toBe(
      result.formatted.indexOf('cell text') + 'cell'.length,
    );
    expect(result.formatted.slice(result.cursorOffset)).toContain(' text');
  });

  test('given a cursor inside a selected table that shrinks during preprocessing, when formatting, then keeps the cursor in the same cell text', async () => {
    const padding = ' '.repeat(80);
    const beforeTable = [
      '| Before long | X   |',
      '| ----------- | --- |',
      '| keep        | as  |',
    ].join('\n');
    const selectedTable = [
      `| Name${padding}| Role${padding}|`,
      `| ---${padding}| ---${padding}|`,
      `| Davey cell text${padding}| Builder${padding}|`,
    ].join('\n');
    const afterTable = [
      '| After long | Y   |',
      '| ---------- | --- |',
      '| keep       | as  |',
    ].join('\n');
    const cursorMarkdown = [
      beforeTable,
      '',
      selectedTable,
      '',
      afterTable,
      '',
    ].join('\n');
    const rangeStart = cursorMarkdown.indexOf('| Name');
    const rangeEnd = cursorMarkdown.indexOf('| After') - 1;
    const cursorOffset = cursorMarkdown.indexOf('cell text') + 'cell'.length;
    const result = await prettier.formatWithCursor(cursorMarkdown, {
      cursorOffset,
      parser: 'markdown',
      plugins: [plugin],
      rangeEnd,
      rangeStart,
    });

    expect(result.formatted).toBe(
      [
        beforeTable,
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey cell text | Builder |',
        '',
        afterTable,
        '',
      ].join('\n'),
    );
    expect(result.cursorOffset).toBe(
      result.formatted.indexOf('cell text') + 'cell'.length,
    );
    expect(result.formatted.slice(result.cursorOffset)).toContain(' text');
  });

  test('given a cursor inside a selected table next to fenced code, when range formatting, then keeps protected code and maps the cursor', async () => {
    const fencedCode = [
      '```md',
      '| Keep  | Fence |',
      '| ----- | ----- |',
      '| this  | text  |',
      '```',
    ].join('\n');
    const selectedTable = [
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey cell text | Builder     |',
    ].join('\n');
    const afterTable = [
      '| After   | Table       |',
      '| ------- | ----------- |',
      '| keep    | as written  |',
    ].join('\n');
    const cursorMarkdown = [
      fencedCode,
      '',
      selectedTable,
      '',
      afterTable,
      '',
    ].join('\n');
    const rangeStart = cursorMarkdown.indexOf('| Name');
    const rangeEnd = cursorMarkdown.indexOf('| After') - 1;
    const cursorOffset = cursorMarkdown.indexOf('cell text') + 'cell'.length;
    const result = await prettier.formatWithCursor(cursorMarkdown, {
      cursorOffset,
      parser: 'markdown',
      plugins: [plugin],
      rangeEnd,
      rangeStart,
    });

    expect(result.formatted).toBe(
      [
        fencedCode,
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey cell text | Builder |',
        '',
        afterTable,
        '',
      ].join('\n'),
    );
    expect(result.cursorOffset).toBe(
      result.formatted.indexOf('cell text') + 'cell'.length,
    );
    expect(result.formatted.slice(result.cursorOffset)).toContain(' text');
  });

  test('given prettier-ignore before a table, when formatting, then leaves that table unchanged', async () => {
    const ignoredTable = [
      '<!-- prettier-ignore -->',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
    ].join('\n');

    await expect(
      prettier.format(ignoredTable, {
        parser: 'markdown',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      [
        '<!-- prettier-ignore -->',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '',
      ].join('\n'),
    );
  });

  test('given MDX prettier-ignore before a Markdown table, when formatting, then leaves that table unchanged', async () => {
    const ignoredTable = [
      '<!-- prettier-ignore -->',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
      '| After  | Table      |',
      '| ------ | ---------- |',
      '| normal | collapses  |',
      '',
    ].join('\n');

    await expect(
      prettier.format(ignoredTable, {
        parser: 'mdx',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      [
        '<!-- prettier-ignore -->',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '',
        '| After | Table |',
        '| --- | --- |',
        '| normal | collapses |',
        '',
      ].join('\n'),
    );
  });

  test('given MDX JSX prettier-ignore before JSX table text, when formatting, then leaves JSX unchanged and collapses the next table', async () => {
    const ignoredJsx = [
      '{/* prettier-ignore */}',
      '<Demo.Root>',
      '  <Demo.Panel>',
      '    | Name  | Role        |',
      '    | ----- | ----------- |',
      '    | Davey | Builder     |',
      '  </Demo.Panel>',
      '</Demo.Root>',
      '',
      '| After  | Table      |',
      '| ------ | ---------- |',
      '| normal | collapses  |',
      '',
    ].join('\n');

    await expect(
      prettier.format(ignoredJsx, {
        parser: 'mdx',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      [
        '{/* prettier-ignore */}',
        '<Demo.Root>',
        '  <Demo.Panel>',
        '    | Name  | Role        |',
        '    | ----- | ----------- |',
        '    | Davey | Builder     |',
        '  </Demo.Panel>',
        '</Demo.Root>',
        '',
        '| After | Table |',
        '| --- | --- |',
        '| normal | collapses |',
        '',
      ].join('\n'),
    );
  });

  test('given MDX JSX prettier-ignore before a Markdown table, when formatting, then leaves that table unchanged', async () => {
    const ignoredTable = [
      '{/* prettier-ignore */}',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
      '| After  | Table      |',
      '| ------ | ---------- |',
      '| normal | collapses  |',
      '',
    ].join('\n');

    await expect(
      prettier.format(ignoredTable, {
        parser: 'mdx',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      [
        '{/* prettier-ignore */}',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '',
        '| After | Table |',
        '| --- | --- |',
        '| normal | collapses |',
        '',
      ].join('\n'),
    );
  });

  test('given MDX JSX prettier-ignore range around tables, when formatting, then does not collapse the range further', async () => {
    const ignoredRange = [
      '{/* prettier-ignore-start */}',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
      '| Keep  | Table       |',
      '| ----- | ----------- |',
      '| yes   | unchanged   |',
      '{/* prettier-ignore-end */}',
      '',
      '| After  | Table      |',
      '| ------ | ---------- |',
      '| normal | collapses  |',
      '',
    ].join('\n');

    await expect(
      prettier.format(ignoredRange, {
        parser: 'mdx',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      [
        '{/* prettier-ignore-start */}',
        '| Name | Role |',
        '| ----- | ----------- |',
        '| Davey | Builder |',
        '',
        '| Keep | Table     |',
        '| ---- | --------- |',
        '| yes  | unchanged |',
        '',
        '{/* prettier-ignore-end */}',
        '',
        '| After | Table |',
        '| --- | --- |',
        '| normal | collapses |',
        '',
      ].join('\n'),
    );
  });

  test('given prettier-ignore range around tables, when formatting, then leaves the range unchanged', async () => {
    const ignoredRange = [
      '<!-- prettier-ignore-start -->',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
      '| Tool  | Use         |',
      '| ----- | ----------- |',
      '| Codex | Pair worker |',
      '<!-- prettier-ignore-end -->',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
    ].join('\n');

    await expect(
      prettier.format(ignoredRange, {
        parser: 'markdown',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      [
        '<!-- prettier-ignore-start -->',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '',
        '| Tool  | Use         |',
        '| ----- | ----------- |',
        '| Codex | Pair worker |',
        '<!-- prettier-ignore-end -->',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '',
      ].join('\n'),
    );
  });

  for (const fixture of FORMAT_FIXTURES) {
    for (const style of FIXTURE_STYLES) {
      test(`given ${fixture.fileName} and ${style} style, when formatting, then output matches the fixture snapshot and stays stable`, async () => {
        const source = readFixture(fixture.fileName);
        const formatted = await formatWithPlugin(source, fixture.parser, style);
        const formattedAgain = await formatWithPlugin(
          formatted,
          fixture.parser,
          style,
        );

        expect(formattedAgain).toBe(formatted);
        expect(formatted).toMatchSnapshot();
      });
    }
  }

  for (const fixture of FORMAT_FIXTURES) {
    test(`given ${fixture.fileName}, when formatting tables, then table cells match built-in Prettier`, async () => {
      const source = readFixture(fixture.fileName);
      const prettierOutput = await prettier.format(source, {
        parser: fixture.parser,
        plugins: [prettierMarkdownPlugin],
      });
      const spacedOutput = await formatWithPlugin(
        source,
        fixture.parser,
        'spaced',
      );
      const compactOutput = await formatWithPlugin(
        source,
        fixture.parser,
        'compact',
      );
      const prettierTables = await parseTableSemantics(
        prettierOutput,
        fixture.parser,
      );

      expect(await parseTableSemantics(spacedOutput, fixture.parser)).toEqual(
        prettierTables,
      );
      expect(await parseTableSemantics(compactOutput, fixture.parser)).toEqual(
        prettierTables,
      );
    });
  }

  test('given inline table content, when reading table semantics, then keeps alignment and inline nodes', async () => {
    const source = [
      '| Left | Center | Right |',
      '| :--- | :---: | ---: |',
      '| `code` | *em* and [link](https://example.com "Title") | a\\|b |',
    ].join('\n');

    await expect(parseTableSemantics(source, 'markdown')).resolves.toEqual([
      {
        align: ['left', 'center', 'right'],
        rows: [
          [
            [{ type: 'text', value: 'Left' }],
            [{ type: 'text', value: 'Center' }],
            [{ type: 'text', value: 'Right' }],
          ],
          [
            [{ type: 'inlineCode', value: 'code' }],
            [
              {
                children: [{ type: 'text', value: 'em' }],
                type: 'emphasis',
              },
              { type: 'text', value: ' and ' },
              {
                children: [{ type: 'text', value: 'link' }],
                title: 'Title',
                type: 'link',
                url: 'https://example.com',
              },
            ],
            [
              { type: 'text', value: 'a' },
              { type: 'text', value: '|' },
              { type: 'text', value: 'b' },
            ],
          ],
        ],
      },
    ]);
  });

  test('given risky inline table content, when formatting through public APIs, then Markdown syntax stays intact', async () => {
    const source = [
      '| Label | Code | Link | Literal |',
      '| --- | --- | --- | --- |',
      '| cafe | `value` | [docs](https://example.com "Docs") | a\\|b |',
      '',
    ].join('\n');

    await expect(formatWithPlugin(source, 'markdown', 'spaced')).resolves.toBe(
      [
        '| Label | Code | Link | Literal |',
        '| --- | --- | --- | --- |',
        '| cafe | `value` | [docs](https://example.com "Docs") | a\\|b |',
        '',
      ].join('\n'),
    );
    await expect(formatWithPlugin(source, 'markdown', 'compact')).resolves.toBe(
      [
        '|Label|Code|Link|Literal|',
        '|---|---|---|---|',
        '|cafe|`value`|[docs](https://example.com "Docs")|a\\|b|',
        '',
      ].join('\n'),
    );
  });

  test('given Unicode-heavy table content, when formatting, then spaced and compact output keep table semantics', async () => {
    const source = [
      '| Label | Value | Link |',
      '| --- | --- | --- |',
      '| café | éclair 😀 | [東京リンク](https://例え.テスト/道 "naïve résumé") |',
      '| 中文 | かなカナ | `emoji 😀 code` |',
      '| family 👨‍👩‍👧‍👦 | Zalgo á | escaped\\|pipe |',
    ].join('\n');
    const expectedTables = await parseTableSemantics(source, 'markdown');
    const spacedOutput = await formatWithPlugin(source, 'markdown', 'spaced');
    const compactOutput = await formatWithPlugin(source, 'markdown', 'compact');

    expect(await parseTableSemantics(spacedOutput, 'markdown')).toEqual(
      expectedTables,
    );
    expect(await parseTableSemantics(compactOutput, 'markdown')).toEqual(
      expectedTables,
    );
  });

  test('given seeded generated inline tables, when formatting, then table AST semantics match built-in Prettier', async () => {
    const random = createSeededRandom(PRETTIER_SEMANTIC_FUZZ_SEED);

    for (let index = 0; index < 16; index++) {
      const source = createSemanticFuzzTable(random, index);
      const prettierOutput = await prettier.format(source, {
        parser: 'markdown',
        plugins: [prettierMarkdownPlugin],
      });
      const prettierTables = await parseTableSemantics(
        prettierOutput,
        'markdown',
      );
      const spacedOutput = await formatWithPlugin(source, 'markdown', 'spaced');
      const compactOutput = await formatWithPlugin(
        source,
        'markdown',
        'compact',
      );
      const spacedTables = await parseTableSemantics(spacedOutput, 'markdown');
      const compactTables = await parseTableSemantics(
        compactOutput,
        'markdown',
      );

      if (
        JSON.stringify(spacedTables) !== JSON.stringify(prettierTables) ||
        JSON.stringify(compactTables) !== JSON.stringify(prettierTables)
      ) {
        throw new Error(
          [
            `Table semantics changed for seed ${PRETTIER_SEMANTIC_FUZZ_SEED} case ${index}.`,
            source,
            JSON.stringify(prettierTables),
            JSON.stringify(spacedTables),
            JSON.stringify(compactTables),
          ].join('\n---\n'),
        );
      }
    }
  });

  test('given repaired escaped-pipe rows, when formatting, then table AST semantics match the valid source', async () => {
    const repairCases = [
      {
        label: 'body escaped pipe',
        source: [
          '| Value | Note |',
          '| --- | --- |',
          '| foo\\|bar | kept |',
        ].join('\n'),
      },
      {
        label: 'header escaped pipe',
        source: [
          '| Value\\|Note | Role |',
          '| --- | --- |',
          '| Davey | Builder |',
        ].join('\n'),
      },
    ];

    for (const repairCase of repairCases) {
      const expectedTables = await parseTableSemantics(
        repairCase.source,
        'markdown',
      );
      const spacedOutput = await formatWithPlugin(
        repairCase.source,
        'markdown',
        'spaced',
      );
      const compactOutput = await formatWithPlugin(
        repairCase.source,
        'markdown',
        'compact',
      );

      expect(
        await parseTableSemantics(spacedOutput, 'markdown'),
        repairCase.label,
      ).toEqual(expectedTables);
      expect(
        await parseTableSemantics(compactOutput, 'markdown'),
        repairCase.label,
      ).toEqual(expectedTables);
    }
  });

  test('given repaired header rows, when normalizing, then spaced and compact output keep header semantics', async () => {
    const repairCases = [
      {
        label: 'header escaped pipe',
        source: [
          '| Value\\          |          Note | Role |',
          '| --- | --- |',
          '| Davey | Builder |',
        ].join('\n'),
        validSource: [
          '| Value\\|Note | Role |',
          '| --- | --- |',
          '| Davey | Builder |',
        ].join('\n'),
      },
      {
        label: 'header code span pipe',
        source: [
          '| `Value | Note` | Role |',
          '| --- | --- |',
          '| literal | Builder |',
        ].join('\n'),
        validSource: [
          '| `Value | Note` | Role |',
          '| --- | --- |',
          '| literal | Builder |',
        ].join('\n'),
      },
    ];

    for (const repairCase of repairCases) {
      const expectedTables = await parseTableSemantics(
        repairCase.validSource,
        'markdown',
      );
      const spacedOutput = normalizeMarkdownTables(repairCase.source);
      const compactOutput = normalizeMarkdownTables(repairCase.source, {
        markdownTableStyle: 'compact',
      });

      expect(
        await parseTableSemantics(spacedOutput, 'markdown'),
        repairCase.label,
      ).toEqual(expectedTables);
      expect(
        await parseTableSemantics(compactOutput, 'markdown'),
        repairCase.label,
      ).toEqual(expectedTables);
    }
  });

  test('given ambiguous extra header cells, when normalizing, then spaced and compact output keep original table semantics', async () => {
    const source = [
      '| Value | Note | Role |',
      '| --- | --- |',
      '| Davey | Builder |',
    ].join('\n');
    const expectedTables = await parseTableSemantics(source, 'markdown');
    const spacedOutput = normalizeMarkdownTables(source);
    const compactOutput = normalizeMarkdownTables(source, {
      markdownTableStyle: 'compact',
    });

    expect(await parseTableSemantics(spacedOutput, 'markdown')).toEqual(
      expectedTables,
    );
    expect(await parseTableSemantics(compactOutput, 'markdown')).toEqual(
      expectedTables,
    );
  });

  test('given ambiguous repair-shaped rows, when formatting, then they match built-in Prettier semantics', async () => {
    const ambiguousCases = [
      {
        label: 'overwide real cell',
        source: [
          '| Name | Note |',
          '| --- | --- |',
          '| Davey | Builder | Writer |',
        ].join('\n'),
      },
      {
        label: 'aligned trailing backslash',
        source: [
          '| Name | Note |',
          '| --- | --- |',
          '| Davey | Builder\\          |          Writer |',
        ].join('\n'),
      },
      {
        label: 'code span pipe',
        source: [
          '| Name | Note |',
          '| --- | --- |',
          '| Davey | `Builder | Writer` |',
        ].join('\n'),
      },
    ];

    for (const ambiguousCase of ambiguousCases) {
      const prettierOutput = await prettier.format(ambiguousCase.source, {
        parser: 'markdown',
        plugins: [prettierMarkdownPlugin],
      });
      const pluginOutput = await formatWithPlugin(
        ambiguousCase.source,
        'markdown',
        'spaced',
      );

      expect(pluginOutput, ambiguousCase.label).toBe(prettierOutput);
      expect(
        await parseTableSemantics(pluginOutput, 'markdown'),
        ambiguousCase.label,
      ).toEqual(await parseTableSemantics(prettierOutput, 'markdown'));
    }
  });

  test('given rows with missing trailing cells, when formatting, then padded output has explicit empty cells', async () => {
    const source = [
      '| Name | Note | Role |',
      '| --- | --- | --- |',
      '| Davey | Builder |',
    ].join('\n');
    const expectedTables: TableSemantics = [
      {
        align: ['none', 'none', 'none'],
        rows: [
          [
            [{ type: 'text', value: 'Name' }],
            [{ type: 'text', value: 'Note' }],
            [{ type: 'text', value: 'Role' }],
          ],
          [
            [{ type: 'text', value: 'Davey' }],
            [{ type: 'text', value: 'Builder' }],
            [],
          ],
        ],
      },
    ];
    const spacedOutput = await formatWithPlugin(source, 'markdown', 'spaced');
    const compactOutput = await formatWithPlugin(source, 'markdown', 'compact');

    expect(await parseTableSemantics(spacedOutput, 'markdown')).toEqual(
      expectedTables,
    );
    expect(await parseTableSemantics(compactOutput, 'markdown')).toEqual(
      expectedTables,
    );
  });

  test('given CRLF fixture input, when formatting twice, then keeps CRLF and stays stable', async () => {
    const source = readFixture('markdown-contexts.md').replace(/\n/g, '\r\n');
    const formatted = await prettier.format(source, {
      endOfLine: 'crlf',
      parser: 'markdown',
      plugins: [plugin],
    });
    const formattedAgain = await prettier.format(formatted, {
      endOfLine: 'crlf',
      parser: 'markdown',
      plugins: [plugin],
    });

    expect(formattedAgain).toBe(formatted);
    expect(formatted).toContain('\r\n');
    expect(formatted.replace(/\r\n/g, '')).not.toContain('\n');
  });

  test('given protected-region fixture text, when normalizing directly, then it remains unchanged', () => {
    const source = readFixture('protected-regions.md');

    expect(normalizeMarkdownTables(source)).toBe(source);
    expect(
      normalizeMarkdownTables(source, { markdownTableStyle: 'compact' }),
    ).toBe(source);
  });

  test('given malformed table fixture text, when normalizing directly, then it remains unchanged', () => {
    const source = readFixture('malformed-tables.md');

    expect(normalizeMarkdownTables(source)).toBe(source);
    expect(
      normalizeMarkdownTables(source, { markdownTableStyle: 'compact' }),
    ).toBe(source);
  });

  test('given code and escaped pipe fixture text, when normalizing directly, then output matches snapshots and stays stable', () => {
    const source = readFixture('helper-semantics.md');
    const spaced = normalizeMarkdownTables(source);
    const compact = normalizeMarkdownTables(source, {
      markdownTableStyle: 'compact',
    });

    expect(normalizeMarkdownTables(spaced)).toBe(spaced);
    expect(
      normalizeMarkdownTables(compact, { markdownTableStyle: 'compact' }),
    ).toBe(compact);
    expect(spaced).toMatchSnapshot();
    expect(compact).toMatchSnapshot();
  });

  test(
    'given a large Markdown file without pipes, when formatting with the plugin, then it stays fast and matches Prettier',
    async () => {
      const source = createLargeMarkdownWithoutPipes(8_000);
      const pluginOutput = await expectFastPluginFormat(
        source,
        'markdown',
        LARGE_NO_PIPE_PLUGIN_FORMAT_TIMEOUT_MS,
      );
      const prettierOutput = await prettier.format(source, {
        parser: 'markdown',
        plugins: [prettierMarkdownPlugin],
      });

      expect(pluginOutput).toBe(prettierOutput);
    },
    LARGE_NO_PIPE_PLUGIN_TEST_TIMEOUT_MS,
  );

  test('given a large Markdown file with tables, when formatting with the plugin, then it stays within the smoke-test limit', async () => {
    const source = createLargeMarkdownWithTables(400);
    const pluginOutput = await expectFastPluginFormat(source, 'markdown');

    expect(pluginOutput).toContain('| Name | Role |');
    expect(pluginOutput).toContain('| Davey 399 | Builder |');
  });

  test('given a large Markdown file with tables, when formatting in a memory-limited process, then retained heap stays bounded', () => {
    const script = `
      import * as prettier from 'prettier';
      import plugin from './dist/index.js';

      const source = Array.from({ length: 300 }, (_, index) => [
        \`Section \${String(index)}\`,
        '',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        \`| Davey \${String(index)} | Builder     |\`,
        '',
      ].join('\\n')).join('\\n');

      global.gc();
      const beforeHeap = process.memoryUsage().heapUsed;
      const start = performance.now();
      const formatted = await prettier.format(source, {
        parser: 'markdown',
        plugins: [plugin],
      });
      const durationMs = performance.now() - start;
      global.gc();
      const retainedHeapBytes = process.memoryUsage().heapUsed - beforeHeap;

      if (!formatted.includes('| Davey 299 | Builder |')) {
        console.error('Expected the large table file to be formatted.');
        process.exit(1);
      }

      if (${JSON.stringify(
        IS_STRICT_PERFORMANCE_TEST,
      )} && durationMs > ${String(LARGE_PLUGIN_FORMAT_TIMEOUT_MS)}) {
        console.error(JSON.stringify({
          durationMs,
          inputSize: source.length,
          maxDurationMs: ${String(LARGE_PLUGIN_FORMAT_TIMEOUT_MS)},
          stressMode: '${PERFORMANCE_TEST_MODE}',
        }));
        process.exit(1);
      }

      if (${JSON.stringify(
        IS_STRICT_PERFORMANCE_TEST,
      )} && retainedHeapBytes > ${String(
        LARGE_PLUGIN_RETAINED_HEAP_LIMIT_BYTES,
      )}) {
        console.error(JSON.stringify({
          durationMs,
          inputSize: source.length,
          maxRetainedHeapBytes: ${String(
            LARGE_PLUGIN_RETAINED_HEAP_LIMIT_BYTES,
          )},
          retainedHeapBytes,
          stressMode: '${PERFORMANCE_TEST_MODE}',
        }));
        process.exit(1);
      }
    `;
    const result = runNodeCli(
      [
        '--expose-gc',
        '--max-old-space-size=192',
        '--input-type=module',
        '--eval',
        script,
      ],
      { timeoutMs: LARGE_PLUGIN_FORMAT_TIMEOUT_MS + 5_000 },
    );

    expectCliStatus(result, 0);
    expect(result.stderr).toBe('');
  });

  test('given a large MDX file with early JSX, when formatting with the plugin, then it stays within the smoke-test limit', async () => {
    const protectedJsx = [
      '<Demo>',
      '  | Keep  | JSX  |',
      '  | ----- | ---- |',
      '  | this  | text |',
      '</Demo>',
      '',
    ].join('\n');
    const source = `${protectedJsx}${createLargeMarkdownWithTables(400)}`;
    const pluginOutput = await expectFastPluginFormat(source, 'mdx');

    expect(pluginOutput).toContain(
      '<Demo>| Keep | JSX | | ----- | ---- | | this | text |</Demo>',
    );
    expect(pluginOutput).toContain('| Davey 399 | Builder |');
  });

  test('given an unnormalized table, when checking with the CLI, then it fails', () => {
    withTemporaryMarkdownFile(
      '| A   | B   |\n| --- | --- |\n| one | two |\n',
      ({ filePath }) => {
        const result = runPrettierCli([
          '--check',
          filePath,
          '--plugin',
          CLI_PLUGIN_PATH,
        ]);

        expectCliCheckMismatch(result, filePath);
      },
    );
  });

  test('given an invalid CLI plugin path, when checking with the CLI, then reports a plugin load failure', () => {
    withTemporaryMarkdownFile(
      '| A   | B   |\n| --- | --- |\n| one | two |\n',
      ({ filePath }) => {
        const result = runPrettierCli([
          '--check',
          filePath,
          '--plugin',
          './dist/missing-plugin.js',
        ]);

        expectCliStatus(result, 1);
        expect(result.stderr).toContain('Cannot find module');
        expect(result.stderr).toContain('dist/missing-plugin.js');
        expect(result.stderr).not.toContain('Code style issues found');
      },
    );
  });

  test('given an unnormalized table, when writing with the CLI, then it rewrites the file', () => {
    withTemporaryMarkdownFile(
      '| A   | B   |\n| --- | --- |\n| one | two |\n',
      ({ filePath }) => {
        const result = runPrettierCli([
          '--write',
          filePath,
          '--plugin',
          CLI_PLUGIN_PATH,
        ]);

        expectCliStatus(result, 0);
        expectNoUnexpectedStderr(result);
        expect(result.stdout).toContain(basename(filePath));
        expect(readFileSync(filePath, 'utf8')).toBe(
          '| A | B |\n| --- | --- |\n| one | two |\n',
        );
      },
    );
  });

  test('given an invalid table style, when writing with the CLI, then it rejects without changing the file', () => {
    for (const invalidStyle of INVALID_MARKDOWN_TABLE_STYLES) {
      const source = '| A   | B   |\n| --- | --- |\n| one | two |\n';

      withTemporaryMarkdownFile(source, ({ filePath }) => {
        const result = runPrettierCli([
          '--write',
          filePath,
          '--plugin',
          CLI_PLUGIN_PATH,
          '--markdown-table-style',
          invalidStyle,
        ]);

        expectCliStatus(result, 1);
        expectInvalidMarkdownTableStyleMessage(result.stderr, invalidStyle);
        expect(result.stdout).toBe('');
        expect(readFileSync(filePath, 'utf8')).toBe(source);
      });
    }
  });

  test('given package metadata, when checking package shape, then the release identity stays locked', () => {
    const packageJson = readPackageJson();
    const repository = readPackageJsonRecord(packageJson, 'repository');
    const bugs = readPackageJsonRecord(packageJson, 'bugs');
    const exportsValue = readPackageJsonRecord(packageJson, 'exports');
    const rootExport = readPackageJsonRecord(exportsValue, '.');
    const publishConfig = readPackageJsonRecord(packageJson, 'publishConfig');
    const peerDependencies = readPackageJsonRecord(
      packageJson,
      'peerDependencies',
    );

    expect(packageJson.name).toBe(EXPECTED_PACKAGE_NAME);
    expect(packageJson.type).toBe('module');
    expect(packageJson.types).toBe('./dist/index.d.ts');
    expect(packageJson.homepage).toBe(`${EXPECTED_PACKAGE_URL}#readme`);
    expect(repository.type).toBe('git');
    expect(repository.url).toBe(EXPECTED_PACKAGE_REPOSITORY_URL);
    expect(bugs.url).toBe(`${EXPECTED_PACKAGE_URL}/issues`);
    expect(Object.keys(exportsValue)).toEqual(['.']);
    expect(rootExport).toEqual({
      import: './dist/index.js',
      types: './dist/index.d.ts',
    });
    expect(publishConfig.access).toBe('public');
    expect(peerDependencies.prettier).toBe('^3.0.0');
  });

  test('given a package dry run, when packing, then only public release files are included', () => {
    const result = runNpmCli(['pack', '--dry-run', '--json', '--silent']);

    expectNoUnexpectedStderr(result);
    expectPackFilesEqual(result, [
      'CHANGELOG.md',
      'CONTRIBUTING.md',
      'LICENSE',
      'README.md',
      'SECURITY.md',
      'dist/index.d.ts',
      'dist/index.d.ts.map',
      'dist/index.js',
      'dist/index.js.map',
      'dist/normalizeMarkdownTables.d.ts',
      'dist/normalizeMarkdownTables.d.ts.map',
      'dist/normalizeMarkdownTables.js',
      'dist/normalizeMarkdownTables.js.map',
      'dist/normalizer/publicTypes.d.ts',
      'dist/normalizer/publicTypes.d.ts.map',
      'docs/audit-checklist.md',
      'docs/release-runbook.md',
      'package.json',
    ]);
    expectPackExcludesFiles(result, [
      'coverage',
      'node_modules',
      'package-lock.json',
      'src/index.ts',
      'src/normalizeMarkdownTables.ts',
      'tests/fixtures/protected-regions.md',
      'tests/prettierPlugin.test.ts',
      'tsconfig.json',
      'tsconfig.test.json',
    ]);
  });

  test('given built JavaScript package files, when checking package output, then generated warnings ship', () => {
    expectBuiltJavaScriptFileStartsWithGeneratedBanner('dist/index.js');
    expectBuiltJavaScriptFileStartsWithGeneratedBanner(
      'dist/normalizeMarkdownTables.js',
    );
  });

  test('given built helper declarations, when checking package output, then the row parser stays private', () => {
    const declaration = readFileSync(
      'dist/normalizeMarkdownTables.d.ts',
      'utf8',
    );

    expect(declaration).not.toContain('parseMarkdownTableRow');
  });

  test('given npm pack emits invalid JSON, when reading pack files, then it reports the parse failure', () => {
    expect(() =>
      readPackFilePaths({
        status: 0,
        stderr: '',
        stdout: 'not json',
      }),
    ).toThrow('Could not parse npm pack JSON.');
  });

  test('given a CLI smoke result has unexpected stderr, when checking stderr, then the failure includes full command output', () => {
    expect(() => {
      expectNoUnexpectedStderr({
        status: 0,
        stderr: 'Deprecation warning',
        stdout: 'formatted.md',
      });
    }).toThrow(
      [
        'Unexpected stderr output.',
        'status: 0',
        'stdout:',
        'formatted.md',
        'stderr:',
        'Deprecation warning',
      ].join('\n'),
    );
  });

  test('given npm pack lifecycle stderr has a new package version, when checking stderr, then it is accepted', () => {
    expectNoUnexpectedStderr(
      {
        status: 0,
        stderr: [
          `> ${PACKAGE_NAME}@1.2.3 prepack`,
          '> npm run build',
          '',
          `> ${PACKAGE_NAME}@1.2.3 build`,
          '> node scripts/build.mjs',
        ].join('\n'),
        stdout: '[]',
      },
      [matchesNpmPackPrepackStderr],
    );
  });

  test('given npm pack lifecycle stderr has real build stderr, when checking stderr, then it fails with full command output', () => {
    const stderr = [
      `> ${PACKAGE_NAME}@1.2.3 prepack`,
      '> npm run build',
      '',
      `> ${PACKAGE_NAME}@1.2.3 build`,
      '> node scripts/build.mjs',
      'src/index.ts(1,1): error TS2304: Cannot find name "missing".',
    ].join('\n');

    expect(() => {
      expectNoUnexpectedStderr(
        {
          status: 0,
          stderr,
          stdout: '[]',
        },
        [matchesNpmPackPrepackStderr],
      );
    }).toThrow(
      [
        'Unexpected stderr output.',
        'status: 0',
        'stdout:',
        '[]',
        'stderr:',
        stderr,
      ].join('\n'),
    );
  });

  test('given a built local checkout, when installing by path with scripts ignored, then it loads the plugin', () => {
    withTemporaryDirectory((directory) => {
      const packageSourceDirectory = join(directory, 'plugin-source');
      const consumerDirectory = join(directory, 'consumer');

      createLocalPackageCheckout(packageSourceDirectory);
      mkdirSync(consumerDirectory);
      writeFileSync(
        join(consumerDirectory, 'package.json'),
        '{"type":"module"}\n',
      );

      const buildResult = runNpmCli(['run', 'build'], {
        cwd: packageSourceDirectory,
      });

      expectCliStatus(buildResult, 0);
      expectNoUnexpectedStderr(buildResult);
      expect(existsSync(join(packageSourceDirectory, 'dist', 'index.js'))).toBe(
        true,
      );

      installLocalPathPackage(consumerDirectory, packageSourceDirectory);
      copyPrettierPeerDependency(consumerDirectory, 'prettier');

      expect(
        existsSync(
          join(
            consumerDirectory,
            'node_modules',
            PACKAGE_NAME,
            'dist',
            'index.js',
          ),
        ),
      ).toBe(true);
      expectConfigLoadedPackagedPluginFormatsMarkdown(consumerDirectory);

      const result = runPackagedPluginSmokeTest(consumerDirectory);

      if (result.status !== 0) {
        throw new Error(
          `Local path install smoke test failed.\n${formatCliResult(result)}`,
        );
      }

      expectNoUnexpectedStderr(result);
    });
  }, 30_000);

  test('given a hung CLI command, when running it, then it times out with command details', () => {
    try {
      runNodeCli(['--eval', 'setInterval(() => undefined, 1_000);'], {
        timeoutMs: 25,
      });
    } catch (error: unknown) {
      if (!(error instanceof Error)) {
        throw error;
      }

      expect(error.message).toContain('Command timed out after 25ms');
      expect(error.message).toContain(process.execPath);
      expect(error.message).toContain('--eval');
      expect(error.message).toContain('setInterval');
      return;
    }

    throw new Error('Expected the hung CLI command to time out.');
  });

  test('given a packed package, when supported Prettier versions and CommonJS callers load it, then it formats tables', () => {
    for (const compatibilityPackage of PRETTIER_COMPATIBILITY_PACKAGES) {
      withTemporaryDirectory((directory) => {
        const packResult = runNpmCli([
          'pack',
          '--json',
          '--pack-destination',
          directory,
        ]);

        expectCliStatus(packResult, 0);
        expectNoUnexpectedStderr(packResult, [matchesNpmPackPrepackStderr]);

        const tarballPath = findPackedTarball(directory);

        installPackedPackage(directory, tarballPath);
        copyPrettierPeerDependency(directory, compatibilityPackage.packageName);
        expectInstalledPackageHasSourceMaps(directory);
        expectClassicTypeScriptConsumerResolvesTypes(directory);
        expectNodeNextTypeScriptConsumerResolvesTypes(directory);
        expectConfigLoadedPackagedPluginFormatsMarkdown(directory);
        expectCommonJsConfigLoadedPackagedPluginFormatsMarkdown(directory);

        const result = runPackagedPluginSmokeTest(directory);

        if (result.status !== 0) {
          throw new Error(
            `${
              compatibilityPackage.label
            } compatibility failed.\n${formatCliResult(result)}`,
          );
        }

        expectNoUnexpectedStderr(result);

        const commonJsResult =
          runPackagedCommonJsDynamicImportSmokeTest(directory);

        if (commonJsResult.status !== 0) {
          throw new Error(
            `${
              compatibilityPackage.label
            } CommonJS dynamic import smoke test failed.\n${formatCliResult(
              commonJsResult,
            )}`,
          );
        }

        expectNoUnexpectedStderr(commonJsResult);

        const commonJsRequireResult =
          runPackagedCommonJsRequireFailureSmokeTest(directory);

        if (commonJsRequireResult.status !== 0) {
          throw new Error(
            `${
              compatibilityPackage.label
            } CommonJS require smoke test failed.\n${formatCliResult(
              commonJsRequireResult,
            )}`,
          );
        }

        expectNoUnexpectedStderr(commonJsRequireResult);
      });
    }
  }, 30_000);

  test('given a markdown table, when debug-checking with the CLI, then it passes', () => {
    withTemporaryMarkdownFile(
      '| A   | B   |\n| --- | --- |\n| one | two |\n',
      ({ filePath }) => {
        const result = runPrettierCli([
          '--debug-check',
          filePath,
          '--plugin',
          CLI_PLUGIN_PATH,
        ]);

        expectCliStatus(result, 0);
        expectNoUnexpectedStderr(result);
      },
    );
  });

  test('given an ignored unnormalized table, when checking with the CLI, then it passes', () => {
    withTemporaryMarkdownFile(
      [
        '<!-- prettier-ignore -->',
        '| A   | B   |',
        '| --- | --- |',
        '| one | two |',
        '',
      ].join('\n'),
      ({ filePath }) => {
        const result = runPrettierCli([
          '--check',
          filePath,
          '--plugin',
          CLI_PLUGIN_PATH,
        ]);

        expectCliStatus(result, 0);
        expectNoUnexpectedStderr(result);
      },
    );
  });
});

function buildCliPlugin(): void {
  const result = runNodeCli(['scripts/build.mjs']);

  if (result.status !== 0) {
    throw new Error(
      `Could not build the CLI test plugin at "${CLI_PLUGIN_PATH}".\n${formatCliResult(
        result,
      )}`,
    );
  }
}

function runPrettierCli(args: ReadonlyArray<string>): CliResult {
  return runNodeCli([PRETTIER_BIN_PATH, ...args]);
}

function formatWithUntypedOptions(
  markdown: string,
  options: Record<string, unknown>,
): unknown {
  return Reflect.apply(prettier.format, undefined, [markdown, options]);
}

function readFixture(fileName: string): string {
  return readFileSync(new URL(`./fixtures/${fileName}`, import.meta.url), {
    encoding: 'utf8',
  });
}

async function formatWithPlugin(
  markdown: string,
  parser: FixtureParser,
  style: MarkdownTableStyle,
): Promise<string> {
  const options: prettier.Options = {
    parser,
    plugins: [plugin],
  };

  if (style !== 'spaced') {
    return prettier.format(markdown, {
      ...options,
      markdownTableStyle: style,
    });
  }

  return prettier.format(markdown, options);
}

function withOptionalMarkdownTableStyle(
  options: prettier.Options,
  markdownTableStyle: MarkdownTableStyle | undefined,
): prettier.Options {
  if (markdownTableStyle === undefined) {
    return options;
  }

  return {
    ...options,
    markdownTableStyle,
  };
}

async function expectInvalidMarkdownTableStyleRejection(
  promise: unknown,
  invalidStyle: string,
): Promise<void> {
  try {
    await Promise.resolve(promise);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    expectInvalidMarkdownTableStyleMessage(message, invalidStyle);
    return;
  }

  throw new Error(
    `Expected markdownTableStyle "${invalidStyle}" to be rejected.`,
  );
}

async function expectFastPluginFormat(
  markdown: string,
  parser: FixtureParser,
  timeoutMs = LARGE_PLUGIN_FORMAT_TIMEOUT_MS,
): Promise<string> {
  const start = IS_STRICT_PERFORMANCE_TEST ? performance.now() : undefined;
  const formatted = await formatWithPlugin(markdown, parser, 'spaced');

  if (start !== undefined) {
    expectPluginDurationBelow(
      performance.now() - start,
      timeoutMs,
      markdown.length,
      'plugin formatting',
    );
  }

  return formatted;
}

function expectPluginDurationBelow(
  durationMs: number,
  maxDurationMs: number,
  inputSize: number,
  label: string,
): void {
  if (!IS_STRICT_PERFORMANCE_TEST) {
    return;
  }

  if (durationMs < maxDurationMs) {
    return;
  }

  throw new Error(
    [
      `Expected ${label} to finish within ${String(maxDurationMs)}ms.`,
      `Elapsed: ${durationMs.toFixed(1)}ms.`,
      `Input size: ${String(inputSize)} characters.`,
      'Stress mode: strict.',
    ].join(' '),
  );
}

function createLargeMarkdownWithoutPipes(lineCount: number): string {
  return `${Array.from(
    { length: lineCount },
    (_, index) => `Paragraph ${String(index)} has ordinary Markdown text.`,
  ).join('\n')}\n`;
}

function createLargeMarkdownWithTables(tableCount: number): string {
  return `${Array.from({ length: tableCount }, (_, index) =>
    [
      `Section ${String(index)}`,
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      `| Davey ${String(index)} | Builder     |`,
      '',
    ].join('\n'),
  ).join('\n')}\n`;
}

async function expectCursorByText(
  expectation: CursorTextExpectation,
): Promise<void> {
  const cursorOffset = getCursorOffset(
    expectation.markdown,
    expectation.cursorText,
    expectation.textBeforeCursor,
  );
  const result = await formatWithCursorByText(expectation, cursorOffset);

  expect(result.cursorOffset).toBe(
    getCursorOffset(
      result.formatted,
      expectation.cursorText,
      expectation.textBeforeCursor,
    ),
  );
  expect(result.formatted.slice(result.cursorOffset)).toContain(
    expectation.cursorText.slice(expectation.textBeforeCursor.length),
  );
}

async function expectCursorByOccurrence(
  expectation: CursorOccurrenceExpectation,
): Promise<void> {
  const cursorOffset = getCursorOffsetAtOccurrence(
    expectation.markdown,
    expectation.cursorText,
    expectation.textBeforeCursor,
    expectation.occurrenceIndex,
  );
  const result = await formatWithCursorByOccurrence(expectation, cursorOffset);

  expect(result.cursorOffset).toBe(
    getCursorOffsetAtOccurrence(
      result.formatted,
      expectation.cursorText,
      expectation.textBeforeCursor,
      expectation.occurrenceIndex,
    ),
  );
  expect(result.formatted.slice(result.cursorOffset)).toContain(
    expectation.cursorText.slice(expectation.textBeforeCursor.length),
  );
}

async function formatWithCursorByText(
  expectation: CursorTextExpectation,
  cursorOffset: number,
): Promise<prettier.CursorResult> {
  if (expectation.options?.markdownTableStyle !== undefined) {
    return prettier.formatWithCursor(expectation.markdown, {
      cursorOffset,
      markdownTableStyle: expectation.options.markdownTableStyle,
      parser: 'markdown',
      plugins: [plugin],
    });
  }

  return prettier.formatWithCursor(expectation.markdown, {
    cursorOffset,
    parser: 'markdown',
    plugins: [plugin],
  });
}

async function formatWithCursorByOccurrence(
  expectation: CursorOccurrenceExpectation,
  cursorOffset: number,
): Promise<prettier.CursorResult> {
  const options: {
    cursorOffset: number;
    markdownTableStyle?: MarkdownTableStyle;
    rangeEnd?: number;
    rangeStart?: number;
  } & prettier.Options = {
    cursorOffset,
    parser: 'markdown',
    plugins: [plugin],
  };

  if (expectation.options?.markdownTableStyle !== undefined) {
    options.markdownTableStyle = expectation.options.markdownTableStyle;
  }

  if (expectation.options?.rangeEnd !== undefined) {
    options.rangeEnd = expectation.options.rangeEnd;
  }

  if (expectation.options?.rangeStart !== undefined) {
    options.rangeStart = expectation.options.rangeStart;
  }

  return prettier.formatWithCursor(expectation.markdown, options);
}

function getCursorOffset(
  markdown: string,
  cursorText: string,
  textBeforeCursor: string,
): number {
  if (!cursorText.startsWith(textBeforeCursor)) {
    throw new Error(
      `Invalid cursor test setup: "${textBeforeCursor}" is not the start of "${cursorText}".`,
    );
  }

  const index = markdown.indexOf(cursorText);

  if (index === -1) {
    throw new Error(
      `Invalid cursor test setup: could not find "${cursorText}" in Markdown.`,
    );
  }

  return index + textBeforeCursor.length;
}

function getCursorOffsetAtOccurrence(
  markdown: string,
  cursorText: string,
  textBeforeCursor: string,
  occurrenceIndex: number,
): number {
  if (!Number.isInteger(occurrenceIndex) || occurrenceIndex < 0) {
    throw new Error(
      `Invalid cursor test setup: occurrenceIndex "${String(
        occurrenceIndex,
      )}" must be a non-negative integer.`,
    );
  }

  if (!cursorText.startsWith(textBeforeCursor)) {
    throw new Error(
      `Invalid cursor test setup: "${textBeforeCursor}" is not the start of "${cursorText}".`,
    );
  }

  let index = -1;
  let searchStart = 0;

  for (
    let currentOccurrence = 0;
    currentOccurrence <= occurrenceIndex;
    currentOccurrence++
  ) {
    index = markdown.indexOf(cursorText, searchStart);

    if (index === -1) {
      throw new Error(
        `Invalid cursor test setup: could not find occurrence ${String(
          occurrenceIndex,
        )} of "${cursorText}" in Markdown.`,
      );
    }

    searchStart = index + cursorText.length;
  }

  return index + textBeforeCursor.length;
}

async function parseTableSemantics(
  markdown: string,
  parser: FixtureParser,
): Promise<TableSemantics> {
  const result = await getPrettierDebugApi().parse(markdown, {
    parser,
    plugins: [prettierMarkdownPlugin],
  });
  const ast = getParsedAst(result);

  return collectTableSemantics(ast);
}

function getPrettierDebugApi(): PrettierDebugApi {
  const prettierModule: unknown = prettier;

  if (!isRecord(prettierModule)) {
    throw new Error(
      'Could not parse Markdown fixture because Prettier is not an object.',
    );
  }

  const debugApi = prettierModule.__debug;

  if (!isRecord(debugApi)) {
    throw new Error(
      'Could not parse Markdown fixture because Prettier debug parse is missing.',
    );
  }

  const parse = debugApi.parse;
  const printDocToString = debugApi.printDocToString;
  const printToDoc = debugApi.printToDoc;

  if (!isUnknownFunction(parse)) {
    throw new Error(
      'Could not parse Markdown fixture because Prettier debug parse is missing.',
    );
  }

  if (!isUnknownFunction(printDocToString)) {
    throw new Error(
      'Could not print Markdown fixture because Prettier debug printDocToString is missing.',
    );
  }

  if (!isUnknownFunction(printToDoc)) {
    throw new Error(
      'Could not print Markdown fixture because Prettier debug printToDoc is missing.',
    );
  }

  return {
    parse(markdown, options) {
      return parse(markdown, options);
    },
    async printDocToString(doc, options) {
      return readPrintedDocResult(await printDocToString(doc, options));
    },
    async printToDoc(markdown, options) {
      return printToDoc(markdown, options);
    },
  };
}

function printRootMarkdownDocWithoutOriginalText(
  markdown: string,
  options: prettier.Options,
  rootNode: MockMarkdownNode = {
    children: [{ type: 'table' }],
    type: 'root',
  },
): unknown {
  return withMockedBuiltInMarkdownPrint(markdown, () => {
    const print = getPluginMarkdownPrinterPrint();

    return print(
      {
        isRoot: true,
        node: rootNode,
      },
      options,
      () => '',
    );
  });
}

function withMockedBuiltInMarkdownPrint<T>(doc: unknown, action: () => T): T {
  const printer = prettierMarkdownPlugin.printers.mdast;
  const descriptor = Object.getOwnPropertyDescriptor(printer, 'print');

  if (descriptor === undefined) {
    throw new Error(
      'Could not print Markdown fixture because the built-in printer is missing.',
    );
  }

  Object.defineProperty(printer, 'print', {
    ...descriptor,
    value: () => doc,
  });

  try {
    return action();
  } finally {
    Object.defineProperty(printer, 'print', descriptor);
  }
}

function getPluginMarkdownPrinterPrint(): UnknownFunction {
  const pluginValue: unknown = plugin;

  if (!isRecord(pluginValue)) {
    throw new Error(
      'Could not print Markdown fixture because the plugin is not an object.',
    );
  }

  const printers = pluginValue.printers;

  if (!isRecord(printers)) {
    throw new Error(
      'Could not print Markdown fixture because the plugin has no printers.',
    );
  }

  const mdastPrinter = printers.mdast;

  if (!isRecord(mdastPrinter)) {
    throw new Error(
      'Could not print Markdown fixture because the Markdown printer is missing.',
    );
  }

  const print = mdastPrinter.print;

  if (!isUnknownFunction(print)) {
    throw new Error(
      'Could not print Markdown fixture because the Markdown print function is missing.',
    );
  }

  return print;
}

function readPrintedDocResult(result: unknown): PrintedDocResult {
  if (!isRecord(result) || typeof result.formatted !== 'string') {
    throw new Error(
      'Could not print Markdown fixture because Prettier returned no formatted text.',
    );
  }

  return {
    formatted: result.formatted,
  };
}

function getParsedAst(result: unknown): unknown {
  if (!isRecord(result) || !('ast' in result)) {
    throw new Error(
      'Could not parse Markdown fixture because Prettier returned no AST.',
    );
  }

  return result.ast;
}

function collectTableSemantics(node: unknown): TableSemantics {
  const tables: Array<TableSemantics[number]> = [];

  visitMarkdownNode(node, (tableNode) => {
    tables.push(readTableSemantics(tableNode));
  });

  return tables;
}

function visitMarkdownNode(
  node: unknown,
  onTable: (tableNode: Record<string, unknown>) => void,
): void {
  if (!isRecord(node)) {
    return;
  }

  if (node.type === 'table') {
    onTable(node);
    return;
  }

  for (const child of getNodeChildren(node)) {
    visitMarkdownNode(child, onTable);
  }
}

function readTableSemantics(
  tableNode: Record<string, unknown>,
): TableSemantics[number] {
  return {
    align: readTableAlign(tableNode),
    rows: getNodeChildren(tableNode)
      .filter(isTableRowNode)
      .map((rowNode) => getNodeChildren(rowNode).map(readTableCellSemantics)),
  };
}

function readTableAlign(
  tableNode: Record<string, unknown>,
): ReadonlyArray<TableAlignment> {
  const align = tableNode.align;

  if (!Array.isArray(align)) {
    return [];
  }

  return align.map(readTableAlignment);
}

function readTableAlignment(value: unknown): TableAlignment {
  if (value === 'center' || value === 'left' || value === 'right') {
    return value;
  }

  return 'none';
}

function readTableCellSemantics(
  node: unknown,
): ReadonlyArray<InlineNodeSemantics> {
  if (!isRecord(node)) {
    return [];
  }

  return getNodeChildren(node).map(readInlineNodeSemantics);
}

function readInlineNodeSemantics(node: unknown): InlineNodeSemantics {
  if (!isRecord(node)) {
    return { type: 'unknown' };
  }

  const semantics: {
    children?: ReadonlyArray<InlineNodeSemantics>;
    title?: string;
    type: string;
    url?: string;
    value?: string;
  } = {
    type: readNodeType(node),
  };

  if (typeof node.value === 'string') {
    semantics.value = node.value;
  }

  if (typeof node.url === 'string') {
    semantics.url = node.url;
  }

  if (typeof node.title === 'string') {
    semantics.title = node.title;
  }

  const children = getNodeChildren(node);

  if (children.length > 0) {
    semantics.children = children.map(readInlineNodeSemantics);
  }

  return semantics;
}

function readNodeType(node: Record<string, unknown>): string {
  if (typeof node.type === 'string') {
    return node.type;
  }

  return 'unknown';
}

function createSeededRandom(seed: number): SeededRandom {
  let state = seed >>> 0;

  return {
    next() {
      state = (state * 1_664_525 + 1_013_904_223) >>> 0;

      return state / 0x1_0000_0000;
    },
  };
}

function randomInt(random: SeededRandom, maxExclusive: number): number {
  return Math.floor(random.next() * maxExclusive);
}

function pick<T>(
  random: SeededRandom,
  values: ReadonlyArray<T>,
  label: string,
): T {
  const value = values[randomInt(random, values.length)];

  if (value === undefined) {
    throw new Error(`Invalid semantic fuzz fixture "${label}" — no values.`);
  }

  return value;
}

function createSemanticFuzzTable(
  random: SeededRandom,
  caseIndex: number,
): string {
  const alignments = [
    { delimiter: '---', label: 'Plain' },
    { delimiter: ':---', label: 'Left' },
    { delimiter: ':---:', label: 'Center' },
    { delimiter: '---:', label: 'Right' },
  ] as const;
  const columnCount = 3 + randomInt(random, 3);
  const selectedAlignments = Array.from({ length: columnCount }, () =>
    pick(random, alignments, 'alignment'),
  );
  const header = selectedAlignments.map(
    (alignment, index) => `${alignment.label} ${caseIndex}-${index}`,
  );
  const rows = Array.from({ length: 2 + randomInt(random, 3) }, (_, rowIndex) =>
    Array.from({ length: columnCount }, (_unused, columnIndex) =>
      createSemanticFuzzCell(random, caseIndex, rowIndex, columnIndex),
    ),
  );

  return [
    `| ${header.join(' | ')} |`,
    `| ${selectedAlignments
      .map((alignment) => alignment.delimiter)
      .join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function createSemanticFuzzCell(
  random: SeededRandom,
  caseIndex: number,
  rowIndex: number,
  columnIndex: number,
): string {
  const token = `${caseIndex}-${rowIndex}-${columnIndex}`;
  const cells = [
    `plain ${token}`,
    `\`code ${token} | pipe\``,
    `*em ${token}*`,
    `[link ${token}](https://example.com/${token} "Title ${token}")`,
    String.raw`escaped\|pipe`,
    `**strong ${token}**`,
  ];

  return pick(random, cells, 'cell');
}

function isTableRowNode(node: unknown): node is Record<string, unknown> {
  return isRecord(node) && node.type === 'tableRow';
}

function getNodeChildren(
  node: Record<string, unknown>,
): ReadonlyArray<unknown> {
  const children = node.children;

  if (!Array.isArray(children)) {
    return [];
  }

  return children;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readPackageJson(): Record<string, unknown> {
  let parsedPackageJson: unknown;

  try {
    parsedPackageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  } catch (error: unknown) {
    throw new Error('Could not read package.json.', {
      cause: error,
    });
  }

  if (!isRecord(parsedPackageJson)) {
    throw new Error('Invalid package.json - expected an object.');
  }

  return parsedPackageJson;
}

function readPackageName(): string {
  const parsedPackageJson = readPackageJson();
  const packageName = parsedPackageJson.name;

  if (typeof packageName !== 'string' || packageName.length === 0) {
    throw new Error('Invalid package.json - expected a non-empty name.');
  }

  return packageName;
}

function readPackageJsonRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = record[key];

  if (!isRecord(value) || Array.isArray(value)) {
    throw new Error(
      `Invalid package.json - expected "${key}" to be an object.`,
    );
  }

  return value;
}

function isUnknownFunction(value: unknown): value is UnknownFunction {
  return typeof value === 'function';
}

function runNpmCli(
  args: ReadonlyArray<string>,
  options: CliRunOptions = {},
): CliResult {
  return runCliCommand(NPM_COMMAND, args, options);
}

function runNodeCli(
  args: ReadonlyArray<string>,
  options: CliRunOptions = {},
): CliResult {
  return runCliCommand(process.execPath, args, options);
}

function runCliCommand(
  command: string,
  args: ReadonlyArray<string>,
  options: CliRunOptions = {},
): CliResult {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    timeout: timeoutMs,
  });

  if (result.error !== undefined) {
    if (result.error.message.includes('ETIMEDOUT')) {
      throw new Error(
        `Command timed out after ${String(timeoutMs)}ms: ${formatCliCommand(
          command,
          args,
        )}`,
        { cause: result.error },
      );
    }

    throw new Error(
      `Could not run command: ${formatCliCommand(command, args)}`,
      {
        cause: result.error,
      },
    );
  }

  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function formatCliCommand(
  command: string,
  args: ReadonlyArray<string>,
): string {
  return [command, ...args].map((part) => JSON.stringify(part)).join(' ');
}

function expectCliStatus(result: CliResult, expectedStatus: number): void {
  if (result.status !== expectedStatus) {
    throw new Error(
      `Expected CLI status ${expectedStatus}, got ${String(
        result.status,
      )}.\n${formatCliResult(result)}`,
    );
  }
}

function expectCliCheckMismatch(result: CliResult, filePath: string): void {
  expectCliStatus(result, 1);
  expectNoPluginLoadError(result);
  expect(result.stdout).toContain('Checking formatting');
  expect(result.stderr).toContain(basename(filePath));
  expect(result.stderr).toContain('Code style issues found');
}

function expectPackFilesEqual(
  result: CliResult,
  expectedFiles: ReadonlyArray<string>,
): void {
  const packFilePaths = [...readPackFilePaths(result)].sort();
  const sortedExpectedFiles = [...expectedFiles].sort();

  expect(packFilePaths).toEqual(sortedExpectedFiles);
}

function expectPackExcludesFiles(
  result: CliResult,
  files: ReadonlyArray<string>,
): void {
  const packFilePaths = readPackFilePaths(result);

  for (const file of files) {
    if (packFilePaths.includes(file)) {
      throw new Error(
        `Expected npm pack files to exclude "${file}".\n${formatPackFilePaths(
          packFilePaths,
        )}`,
      );
    }
  }
}

function expectBuiltJavaScriptFileStartsWithGeneratedBanner(
  filePath: string,
): void {
  const content = readFileSync(filePath, 'utf8');

  if (!content.startsWith(`${GENERATED_JAVASCRIPT_BANNER}\n`)) {
    throw new Error(
      `Expected "${filePath}" to start with the generated file warning.`,
    );
  }
}

function readPackFilePaths(result: CliResult): ReadonlyArray<string> {
  expectCliStatus(result, 0);

  return readPackResult(result).files.map(({ path }) => path);
}

function readPackResult(result: CliResult): NpmPackResult {
  const packResults = parseNpmPackResults(result);

  if (packResults.length !== 1) {
    throw new Error(
      `Expected one npm pack result, found ${String(
        packResults.length,
      )}.\n${formatCliResult(result)}`,
    );
  }

  const packResult = packResults[0];

  if (packResult === undefined) {
    throw new Error(
      `Expected one npm pack result.\n${formatCliResult(result)}`,
    );
  }

  return packResult;
}

function parseNpmPackResults(result: CliResult): ReadonlyArray<NpmPackResult> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(result.stdout);
  } catch (error: unknown) {
    throw new Error(
      `Could not parse npm pack JSON.\n${formatCliResult(result)}`,
      { cause: error },
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      `Invalid npm pack JSON — expected an array.\n${formatCliResult(result)}`,
    );
  }

  return parsed.map(readNpmPackResult);
}

function readNpmPackResult(value: unknown): NpmPackResult {
  if (!isRecord(value)) {
    throw new Error(
      'Invalid npm pack JSON — expected each result to be an object.',
    );
  }

  const files = value.files;

  if (!Array.isArray(files)) {
    throw new Error(
      'Invalid npm pack JSON — expected result.files to be an array.',
    );
  }

  return {
    files: files.map(readNpmPackFile),
  };
}

function readNpmPackFile(value: unknown): NpmPackFile {
  if (!isRecord(value) || typeof value.path !== 'string') {
    throw new Error(
      'Invalid npm pack JSON — expected each file to have a string path.',
    );
  }

  return {
    path: value.path,
  };
}

function formatPackFilePaths(packFilePaths: ReadonlyArray<string>): string {
  return [
    'Parsed npm pack files:',
    ...packFilePaths.map((filePath) => `- ${filePath}`),
  ].join('\n');
}

function expectNoPluginLoadError(result: CliResult): void {
  if (
    result.stderr.includes('Cannot find module') ||
    result.stderr.includes('Could not resolve')
  ) {
    throw new Error(
      `Prettier could not load the plugin.\n${formatCliResult(result)}`,
    );
  }
}

function expectInvalidMarkdownTableStyleMessage(
  message: string,
  invalidStyle: string,
): void {
  const plainMessage = stripAnsi(message);

  expect(plainMessage).toContain('Invalid');
  expect(
    plainMessage.includes('markdownTableStyle') ||
      plainMessage.includes('markdown-table-style'),
  ).toBe(true);
  expect(plainMessage).toContain(`received "${invalidStyle}"`);
  expect(plainMessage).toContain('"compact"');
  expect(plainMessage).toContain('"prettier"');
  expect(plainMessage).toContain('"spaced"');
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, '');
}

function expectNoUnexpectedStderr(
  result: CliResult,
  allowedStderr: ReadonlyArray<AllowedStderr> = [],
): void {
  const actualStderr = normalizeCliStderr(result.stderr);

  if (actualStderr === '') {
    return;
  }

  const isAllowed = allowedStderr.some((expected) =>
    isAllowedStderr(actualStderr, expected),
  );

  if (isAllowed) {
    return;
  }

  throw new Error(`Unexpected stderr output.\n${formatCliResult(result)}`);
}

function isAllowedStderr(
  stderr: string,
  allowedStderr: AllowedStderr,
): boolean {
  if (typeof allowedStderr === 'string') {
    return stderr === normalizeCliStderr(allowedStderr);
  }

  return allowedStderr(stderr);
}

function matchesNpmPackPrepackStderr(stderr: string): boolean {
  const lines = stderr.split('\n');

  if (lines.length !== 4) {
    return false;
  }

  const [prepackBanner, prepackCommand, buildBanner, buildCommand] = lines;

  if (
    prepackBanner === undefined ||
    prepackCommand === undefined ||
    buildBanner === undefined ||
    buildCommand === undefined
  ) {
    return false;
  }

  return (
    isNpmLifecycleBanner(prepackBanner, 'prepack') &&
    prepackCommand === '> npm run build' &&
    isNpmLifecycleBanner(buildBanner, 'build') &&
    buildCommand === '> node scripts/build.mjs'
  );
}

function isNpmLifecycleBanner(line: string, scriptName: string): boolean {
  const prefix = `> ${PACKAGE_NAME}@`;
  const suffix = ` ${scriptName}`;

  if (!line.startsWith(prefix) || !line.endsWith(suffix)) {
    return false;
  }

  const version = line.slice(prefix.length, line.length - suffix.length);

  return version.length > 0 && !version.includes(' ');
}

function normalizeCliStderr(stderr: string): string {
  return stderr
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
    .join('\n');
}

function formatCliResult(result: CliResult): string {
  return [
    `status: ${String(result.status)}`,
    'stdout:',
    result.stdout,
    'stderr:',
    result.stderr,
  ].join('\n');
}

function findPackedTarball(directory: string): string {
  const tarballs = readdirSync(directory).filter((fileName) =>
    fileName.endsWith('.tgz'),
  );

  if (tarballs.length !== 1) {
    throw new Error(
      `Expected one packed tarball in "${directory}", found ${String(
        tarballs.length,
      )}.`,
    );
  }

  const tarball = tarballs[0];

  if (tarball === undefined) {
    throw new Error(`Expected a packed tarball in "${directory}".`);
  }

  return join(directory, tarball);
}

function installPackedPackage(directory: string, tarballPath: string): void {
  const result = runNpmCli(
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--legacy-peer-deps',
      '--no-save',
      tarballPath,
    ],
    { cwd: directory },
  );

  expectCliStatus(result, 0);
}

function createLocalPackageCheckout(directory: string): void {
  const installedDependenciesDirectory = join(process.cwd(), 'node_modules');

  if (!existsSync(installedDependenciesDirectory)) {
    throw new Error(
      `Could not create the local install smoke test checkout. Missing "${installedDependenciesDirectory}".`,
    );
  }

  mkdirSync(directory, { recursive: true });
  cpSync(join(process.cwd(), 'package.json'), join(directory, 'package.json'));
  cpSync(
    join(process.cwd(), 'tsconfig.json'),
    join(directory, 'tsconfig.json'),
  );
  cpSync(join(process.cwd(), 'scripts'), join(directory, 'scripts'), {
    recursive: true,
  });
  cpSync(join(process.cwd(), 'src'), join(directory, 'src'), {
    recursive: true,
  });
  symlinkSync(
    installedDependenciesDirectory,
    join(directory, 'node_modules'),
    'dir',
  );
}

function installLocalPathPackage(
  directory: string,
  packageSourceDirectory: string,
): void {
  const result = runNpmCli(
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--legacy-peer-deps',
      '--no-save',
      packageSourceDirectory,
    ],
    { cwd: directory },
  );

  expectCliStatus(result, 0);
}

function copyPrettierPeerDependency(
  directory: string,
  packageName: string,
): void {
  const nodeModulesDirectory = join(directory, 'node_modules');
  const prettierSource = join(process.cwd(), 'node_modules', packageName);
  const prettierTarget = join(nodeModulesDirectory, 'prettier');

  if (!existsSync(prettierSource)) {
    throw new Error(
      `Could not link Prettier for the package smoke test. Missing "${prettierSource}".`,
    );
  }

  mkdirSync(nodeModulesDirectory, { recursive: true });
  rmSync(prettierTarget, { force: true, recursive: true });
  cpSync(prettierSource, prettierTarget, {
    dereference: true,
    recursive: true,
  });
}

function expectInstalledPackageHasSourceMaps(directory: string): void {
  const packageDirectory = join(directory, 'node_modules', PACKAGE_NAME);
  const distDirectory = join(packageDirectory, 'dist');
  const declaration = readFileSync(join(distDirectory, 'index.d.ts'), 'utf8');
  const bundledPlugin = readFileSync(join(distDirectory, 'index.js'), 'utf8');

  expect(declaration).toContain('sourceMappingURL=index.d.ts.map');
  expect(bundledPlugin).toContain('sourceMappingURL=index.js.map');
  expect(existsSync(join(distDirectory, 'index.d.ts.map'))).toBe(true);
  expect(existsSync(join(distDirectory, 'index.js.map'))).toBe(true);
  expect(
    existsSync(join(distDirectory, 'normalizeMarkdownTables.d.ts.map')),
  ).toBe(true);
  expect(
    existsSync(join(distDirectory, 'normalizeMarkdownTables.js.map')),
  ).toBe(true);
  expect(
    existsSync(join(distDirectory, 'normalizer', 'publicTypes.d.ts.map')),
  ).toBe(true);
}

function expectClassicTypeScriptConsumerResolvesTypes(directory: string): void {
  writeFileSync(
    join(directory, 'consumer.ts'),
    [
      `import { normalizeMarkdownTables } from '${PACKAGE_NAME}';`,
      '',
      'const formatted: string = normalizeMarkdownTables(',
      "  '| A   | B   |\\n| --- | --- |\\n| one | two |\\n',",
      ');',
      '',
      "if (!formatted.includes('| A | B |')) {",
      '  throw new Error(formatted);',
      '}',
    ].join('\n'),
  );
  writeFileSync(
    join(directory, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'Node',
          noEmit: true,
          strict: true,
          target: 'ES2022',
        },
        include: ['consumer.ts'],
      },
      undefined,
      2,
    ),
  );

  const result = runNodeCli(
    [join(process.cwd(), TSC_BIN_PATH), '-p', 'tsconfig.json'],
    {
      cwd: directory,
    },
  );

  expectCliStatus(result, 0);
}

function expectNodeNextTypeScriptConsumerResolvesTypes(
  directory: string,
): void {
  writeFileSync(
    join(directory, 'nodenext-consumer.mts'),
    [
      "import type { Options, Plugin } from 'prettier';",
      `import plugin, { normalizeMarkdownTables, type MarkdownTableStyle, type NormalizeMarkdownTablesOptions, type ParsedMarkdownTableRow, type TableRowPrefix } from '${PACKAGE_NAME}';`,
      '',
      "const style: MarkdownTableStyle = 'spaced';",
      'const parsedRows: ReadonlyArray<ParsedMarkdownTableRow> = [];',
      'const parsedPrefix: TableRowPrefix | undefined = parsedRows[0]?.prefix;',
      'const options: NormalizeMarkdownTablesOptions = {',
      '  markdownTableStyle: style,',
      '  maxInputBytes: 1024,',
      '};',
      'const prettierOptions: Options = {',
      '  markdownTableStyle: style,',
      "  parser: 'markdown',",
      '  plugins: [plugin],',
      '};',
      'const formatted: string = normalizeMarkdownTables(',
      "  '| A   | B   |\\n| --- | --- |\\n| one | two |\\n',",
      '  options,',
      ');',
      'const packagedPlugin: Plugin = plugin;',
      '',
      "if (!formatted.includes('| A | B |')) {",
      '  throw new Error(formatted);',
      '}',
      '',
      'if (packagedPlugin.parsers === undefined) {',
      "  throw new Error('Missing parsers.');",
      '}',
      '',
      'if (prettierOptions.markdownTableStyle !== style) {',
      "  throw new Error('Missing markdownTableStyle option.');",
      '}',
      '',
      'if (parsedRows.some((row) => row.content.length > 0)) {',
      "  throw new Error('Unexpected parsed row.');",
      '}',
      '',
      'void parsedPrefix;',
    ].join('\n'),
  );
  writeFileSync(
    join(directory, 'tsconfig.nodenext.json'),
    JSON.stringify(
      {
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          strict: true,
          target: 'ES2022',
        },
        include: ['nodenext-consumer.mts'],
      },
      undefined,
      2,
    ),
  );

  const result = runNodeCli(
    [join(process.cwd(), TSC_BIN_PATH), '-p', 'tsconfig.nodenext.json'],
    {
      cwd: directory,
    },
  );

  expectCliStatus(result, 0);
}

function expectConfigLoadedPackagedPluginFormatsMarkdown(
  directory: string,
): void {
  expectConfigLoadedPackagedPluginFormatsFile({
    config: {
      plugins: [PACKAGE_NAME],
    },
    directory,
    expected: '| A | B |\n| --- | --- |\n| one | two |\n',
    fileName: 'default-spaced.md',
  });
  expectConfigLoadedPackagedPluginFormatsFile({
    config: {
      markdownTableStyle: 'compact',
      plugins: [PACKAGE_NAME],
    },
    directory,
    expected: '|A|B|\n|---|---|\n|one|two|\n',
    fileName: 'explicit-compact.md',
  });
}

function expectCommonJsConfigLoadedPackagedPluginFormatsMarkdown(
  directory: string,
): void {
  const configFileName = '.prettierrc.cjs';
  const fileName = 'commonjs-config.md';
  const filePath = join(directory, fileName);

  writeFileSync(
    join(directory, configFileName),
    ['module.exports = {', `  plugins: ['${PACKAGE_NAME}'],`, '};', ''].join(
      '\n',
    ),
  );
  writeFileSync(filePath, '| A   | B   |\n| --- | --- |\n| one | two |\n');

  const result = runNodeCli(
    [
      join(directory, 'node_modules', 'prettier', 'bin', 'prettier.cjs'),
      '--config',
      configFileName,
      '--write',
      fileName,
    ],
    { cwd: directory },
  );

  expectCliStatus(result, 0);
  expectNoUnexpectedStderr(result);
  expect(readFileSync(filePath, 'utf8')).toBe(
    '| A | B |\n| --- | --- |\n| one | two |\n',
  );
}

function expectConfigLoadedPackagedPluginFormatsFile({
  config,
  directory,
  expected,
  fileName,
}: {
  readonly config: Record<string, unknown>;
  readonly directory: string;
  readonly expected: string;
  readonly fileName: string;
}): void {
  const filePath = join(directory, fileName);

  writeFileSync(
    join(directory, '.prettierrc'),
    `${JSON.stringify(config, undefined, 2)}\n`,
  );
  writeFileSync(filePath, '| A   | B   |\n| --- | --- |\n| one | two |\n');

  const result = runNodeCli(
    [
      join(directory, 'node_modules', 'prettier', 'bin', 'prettier.cjs'),
      '--write',
      fileName,
    ],
    { cwd: directory },
  );

  expectCliStatus(result, 0);
  expectNoUnexpectedStderr(result);
  expect(readFileSync(filePath, 'utf8')).toBe(expected);
}

function runPackagedPluginSmokeTest(directory: string): CliResult {
  const script = `
    import * as prettier from 'prettier';
    import * as packageApi from '${PACKAGE_NAME}';
    import plugin, { normalizeMarkdownTables } from '${PACKAGE_NAME}';

    if ('parseMarkdownTableRow' in packageApi) {
      console.error('parseMarkdownTableRow should not be exported.');
      process.exit(1);
    }

    const formatted = await prettier.format(
      '| A   | B   |\\n| --- | --- |\\n| one | two |\\n',
      {
        parser: 'markdown',
        plugins: [plugin],
      },
    );

    if (formatted !== '| A | B |\\n| --- | --- |\\n| one | two |\\n') {
      console.error(formatted);
      process.exit(1);
    }

    const pipeProse = await prettier.format('Intro | not a table\\n', {
      parser: 'markdown',
      plugins: [plugin],
    });

    if (pipeProse !== 'Intro | not a table\\n') {
      console.error(pipeProse);
      process.exit(1);
    }

    const normalized = normalizeMarkdownTables(
      '| A   | B   |\\n| --- | --- |\\n| one | two |\\n',
    );

    if (normalized !== '| A | B |\\n| --- | --- |\\n| one | two |\\n') {
      console.error(normalized);
      process.exit(1);
    }

    const compact = normalizeMarkdownTables(
      '| A   | B   |\\n| --- | --- |\\n| one | two |\\n',
      { markdownTableStyle: 'compact' },
    );

    if (compact !== '|A|B|\\n|---|---|\\n|one|two|\\n') {
      console.error(compact);
      process.exit(1);
    }
  `;

  return runNodeCli(['--input-type=module', '--eval', script], {
    cwd: directory,
  });
}

function runPackagedCommonJsDynamicImportSmokeTest(
  directory: string,
): CliResult {
  const script = `
    (async () => {
      const { normalizeMarkdownTables } = await import('${PACKAGE_NAME}');
      const normalized = normalizeMarkdownTables(
        '| A   | B   |\\n| --- | --- |\\n| one | two |\\n',
      );

      if (normalized !== '| A | B |\\n| --- | --- |\\n| one | two |\\n') {
        console.error(normalized);
        process.exit(1);
      }
    })().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  `;

  return runNodeCli(['--eval', script], {
    cwd: directory,
  });
}

function runPackagedCommonJsRequireFailureSmokeTest(
  directory: string,
): CliResult {
  const script = `
    try {
      require('${PACKAGE_NAME}');
      console.error('Direct require should fail when Node ESM require interop is disabled.');
      process.exit(1);
    } catch (error) {
      if (!(error instanceof Error)) {
        console.error(error);
        process.exit(1);
      }

      if (
        error.code !== 'ERR_REQUIRE_ESM' &&
        error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED'
      ) {
        console.error(error);
        process.exit(1);
      }
    }
  `;

  return runNodeCli(['--no-experimental-require-module', '--eval', script], {
    cwd: directory,
  });
}

function withTemporaryDirectory(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'collapse-markdown-tables-'));
  let didThrow = false;
  let thrownError: unknown;

  try {
    run(directory);
  } catch (error: unknown) {
    didThrow = true;
    thrownError = error;
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }

  expect(existsSync(directory)).toBe(false);

  if (didThrow) {
    throw thrownError;
  }
}

function withTemporaryMarkdownFile(
  contents: string,
  run: (file: TemporaryMarkdownFile) => void,
): void {
  withTemporaryDirectory((directory) => {
    const filePath = join(directory, 'table.md');

    writeFileSync(filePath, contents);
    run({ directory, filePath });
  });
}
