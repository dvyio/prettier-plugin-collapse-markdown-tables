import * as prettier from 'prettier';
import * as prettierMarkdownPlugin from 'prettier/plugins/markdown';
import { describe, expect, test } from 'vitest';

import plugin from '../src/index.js';
import { normalizeMarkdownTables } from '../src/normalizeMarkdownTables.js';
import { repairPrettierWidenedTableDelimiters } from '../src/normalizer/prettierParse.js';

const IGNORE_DIRECTIVE_CASES = [
  { directive: '<!-- prettier-ignore -->', parser: 'markdown' },
  { directive: '{/* prettier-ignore */}', parser: 'mdx' },
] as const;

describe('Markdown table parser preprocessing', () => {
  test('given matching rows follow a mismatched separator, when formatting, then preserves code inside the recovered table', async () => {
    for (const prefix of ['', '> ']) {
      const source = [
        '| Old | Shape |',
        '| --- | --- | --- |',
        '| Name | Note |',
        '| --- | --- |',
        '| one | `x|y` |',
        '',
      ]
        .map((line) => `${prefix}${line}`)
        .join('\n');
      for (const parser of ['markdown', 'mdx', 'remark'] as const) {
        for (const markdownTableStyle of [
          'spaced',
          'compact',
          'prettier',
        ] as const) {
          const options = { markdownTableStyle, parser, plugins: [plugin] };
          const formatted = await prettier.format(source, options);
          const label = `${parser} ${markdownTableStyle}\n${source}`;

          const lastRow = formatted.trimEnd().split('\n').at(-1);

          // Prettier versions disagree about the earlier mismatched pair; the later row must keep both cells.
          expect(formatted, label).toMatch(
            /^(?:>\s*)?\|\s*Old\s*\|\s*Shape\s*\|$/mu,
          );
          expect(formatted, label).toMatch(
            /^(?:>\s*)?\|\s*Name\s*\|\s*Note\s*\|$/mu,
          );
          expect(lastRow, label).toMatch(
            /^(?:>\s*)?\|\s*one\s*\|\s*`x\\\|y`\s*\|$/u,
          );
          expect(await prettier.format(formatted, options), label).toBe(
            formatted,
          );
        }
      }
    }
  });

  test('given an unindented separator under a list table header, when formatting, then preserves inline-code contents', async () => {
    const sources = [
      ['- Name | Role', '--- | ---', 'Value | `a|b`', ''].join('\n'),
      ['> 1. Name | Role', '> --- | ---', '> Value | `a|b`', ''].join('\n'),
    ];

    for (const source of sources) {
      for (const parser of ['markdown', 'mdx', 'remark'] as const) {
        const builtin = await prettier.format(
          source.replace('`a|b`', '`a\\|b`'),
          { parser },
        );
        const builtinAgain = await prettier.format(builtin, { parser });
        const builtinIsStable =
          (await prettier.format(builtinAgain, { parser })) === builtinAgain;

        for (const markdownTableStyle of [
          'spaced',
          'compact',
          'prettier',
        ] as const) {
          const options = { markdownTableStyle, parser, plugins: [plugin] };
          const formatted = await prettier.format(source, options);
          const label = `${parser} ${markdownTableStyle} ${source}`;

          expect(formatted, label).toBe(
            normalizeMarkdownTables(builtin, { markdownTableStyle }),
          );
          expect(formatted, label).toContain('`a\\|b`');
          const formattedAgain = await prettier.format(formatted, options);

          expect(formattedAgain, label).toBe(
            normalizeMarkdownTables(builtinAgain, { markdownTableStyle }),
          );
          expect(formattedAgain, label).toContain('`a\\|b`');

          // Some Prettier versions turn this list paragraph into a table only on the second pass.
          if (builtinIsStable) {
            expect(await prettier.format(formattedAgain, options), label).toBe(
              formattedAgain,
            );
          }
        }
      }
    }
  });

  test('given printed paragraphs contain short separators, when repairing widened delimiters, then preserves every byte', () => {
    for (const source of [
      ['Notes:', 'use `a|b` | or c', '-|-|-', 'then `d|e` | f', ''].join('\n'),
      ['intro', 'a | `x|y`', ':- | -: | -', 'then `d|e` | f', ''].join('\n'),
    ]) {
      for (const markdownTableStyle of ['spaced', 'compact'] as const) {
        expect(
          repairPrettierWidenedTableDelimiters(source, { markdownTableStyle }),
          `${markdownTableStyle}\n${source}`,
        ).toBe(source);
      }
    }
  });

  test('given a paragraph continuation followed by a dash list item, when formatting, then leaves paragraph code pipes untouched', async () => {
    for (const introduction of [
      'intro',
      '- item',
      '- # Heading',
      '> prior',
      '>',
      '> # heading',
      '> ```\n> code\n> ```',
      '===',
    ]) {
      const source = [introduction, 'a | `x|y`', '- | -', ''].join('\n');

      for (const parser of ['markdown', 'mdx', 'remark'] as const) {
        const expected = await prettier.format(source, { parser });

        for (const markdownTableStyle of [
          'spaced',
          'compact',
          'prettier',
        ] as const) {
          const options = { markdownTableStyle, parser, plugins: [plugin] };
          const formatted = await prettier.format(source, options);
          const label = `${parser} ${markdownTableStyle}\n${source}`;

          expect(formatted, label).toBe(expected);
          expect(await prettier.format(formatted, options), label).toBe(
            formatted,
          );
        }
      }
    }
  });

  test('given short separators follow a new block, when formatting, then still protects table code pipes', async () => {
    const sources = [
      '\uFEFFName | Note\n- | -\none | `a|b`\n',
      '# Heading\nName | Note\n- | -\none | `a|b`\n',
      '***\nName | Note\n- | -\none | `a|b`\n',
      '* * *\nName | Note\n- | -\none | `a|b`\n',
      '- - -\nName | Note\n- | -\none | `a|b`\n',
      '```text\ncode\n```\nName | Note\n- | -\none | `a|b`\n',
      'intro\n> Name | Note\n> - | -\n> one | `a|b`\n',
      '> intro\n> > Name | Note\n> > - | -\n> > one | `a|b`\n',
      '> intro\n>\n> Name | Note\n> - | -\n> one | `a|b`\n',
      '> # Heading\n> Name | Note\n> - | -\n> one | `a|b`\n',
      'intro\n- Name | Note\n  - | -\n  one | `a|b`\n',
      'intro\n1. Name | Note\n   - | -\n   one | `a|b`\n',
      '2. Name | Note\n   - | -\n   one | `a|b`\n',
      '- # Heading\n  Name | Note\n  - | -\n  one | `a|b`\n',
    ];

    for (const source of sources) {
      const expected = await formatWithBuiltInPrettier(
        source.replace('`a|b`', '`a\\|b`'),
      );

      expect(await formatWithPluginPrettierStyle(source), source).toBe(
        expected,
      );
    }
  });

  test('given an ordered marker cannot interrupt a paragraph, when formatting, then leaves its code pipes untouched', async () => {
    const source = ['intro', '2. Name | `a|b`', '   - | -', ''].join('\n');

    expect(await formatWithPluginPrettierStyle(source)).toBe(
      await formatWithBuiltInPrettier(source),
    );
  });

  test('given consecutive ignore directives, when formatting, then keeps the following table unchanged', async () => {
    for (const { directive, parser } of IGNORE_DIRECTIVE_CASES) {
      for (const nextDirective of [
        directive,
        directive.replace('prettier-ignore', 'prettier-ignore-start'),
      ]) {
        const source = [
          directive,
          nextDirective,
          '',
          '| Name     | Note      |',
          '| -------- | --------- |',
          '| one      | two       |',
          '',
          directive.replace('prettier-ignore', 'prettier-ignore-end'),
          '',
        ].join('\n');

        expect(
          await prettier.format(source, {
            parser,
            plugins: [plugin],
          }),
          source,
        ).toBe(await formatWithBuiltInPrettier(source, parser));
      }
    }
  });

  test('given sibling list items resemble short table delimiters, when formatting, then leaves their inline-code pipes untouched', async () => {
    for (const prefix of ['', '> ']) {
      for (const separator of ['-', '---']) {
        const siblingItems = [
          `${prefix}- | Name | Note | \`a|b\` |`,
          `${prefix}- | ${separator} | ${separator} |`,
          `${prefix}- | one | two | three |`,
          '',
        ].join('\n');
        const continuedItem = [
          `${prefix}- item`,
          prefix,
          `${prefix}  | Name | Note | \`a|b\` |`,
          `${prefix}- | ${separator} | ${separator} |`,
          `${prefix}- | one | two | three |`,
          '',
        ].join('\n');

        for (const source of [siblingItems, continuedItem]) {
          expect(await formatWithPluginPrettierStyle(source), source).toBe(
            await formatWithBuiltInPrettier(source),
          );
        }
      }
    }
  });

  test('given ignored containers contain short separators, when formatting, then leaves their inline-code pipes untouched', async () => {
    for (const separator of ['-', '--', ':-', '-:']) {
      for (const outerPipe of ['', '|']) {
        const table = [
          `${outerPipe} Name | Note ${outerPipe}`,
          `${outerPipe} ${separator} | ${separator} ${outerPipe}`,
          `${outerPipe} one | \`a|b\` ${outerPipe}`,
        ];
        for (const { directive, parser } of IGNORE_DIRECTIVE_CASES) {
          const sources = [
            [
              directive,
              '- item',
              '',
              ...table.map((line) => `  ${line}`),
              '',
            ].join('\n'),
            [
              directive,
              '> title',
              '>',
              ...table.map((line) => `> ${line}`),
              '',
            ].join('\n'),
          ];

          for (const source of sources) {
            const withFollowingTable = `${source}\nName | Note\n${separator} | ${separator}\ntwo | \`c|d\`\n`;
            const expected = await formatWithBuiltInPrettier(
              withFollowingTable.replace('`c|d`', '`c\\|d`'),
              parser,
            );
            const actual = await formatWithPluginPrettierStyle(
              withFollowingTable,
              parser,
            );
            const label = `${parser}\n${withFollowingTable}`;

            expect(actual, label).toBe(expected);
            expect(actual, label).toContain('`a|b`');
            expect(actual, label).toContain('`c\\|d`');
          }
        }
      }
    }
  });

  test('given an ignored list has code pipes in a later item, when formatting, then leaves the whole list unchanged', async () => {
    for (const { directive, parser } of IGNORE_DIRECTIVE_CASES) {
      for (const secondItem of ['- Second', '-     code']) {
        const source = [
          directive,
          '- First',
          '  | Name     | Note      |',
          '  | -------- | --------- |',
          '  | one      | first     |',
          '',
          secondItem,
          '',
          '  | Name     | Note      |',
          '  | -------- | --------- |',
          '  | two      | `a|b`     |',
          '',
        ].join('\n');

        expect(
          await formatWithPluginPrettierStyle(source, parser),
          source,
        ).toBe(await formatWithBuiltInPrettier(source, parser));
      }
    }
  });

  test('given an ignored list starts with a lazy paragraph line, when formatting, then preserves later tables and their code pipes', async () => {
    for (const { directive, parser } of IGNORE_DIRECTIVE_CASES) {
      const source = [
        directive,
        '- foo',
        'bar',
        '- item',
        '',
        '  | a   | b       |',
        '  | --- | ------- |',
        '  | one | `x|y`   |',
        '',
      ].join('\n');
      const expected = await formatWithBuiltInPrettier(source, parser);

      for (const markdownTableStyle of [
        'spaced',
        'compact',
        'prettier',
      ] as const) {
        const options = { markdownTableStyle, parser, plugins: [plugin] };
        const formatted = await prettier.format(source, options);
        const label = `${markdownTableStyle}\n${source}`;

        expect(formatted, label).toBe(expected);
        expect(await prettier.format(formatted, options), label).toBe(
          formatted,
        );
      }
    }
  });

  test('given an ignore directive before a nested list, when formatting a parent sibling table, then collapses that table', async () => {
    for (const { directive, parser } of IGNORE_DIRECTIVE_CASES) {
      for (const [parentMarker, parentSibling] of [
        ['-', '-'],
        ['1.', '2.'],
      ] as const) {
        for (const [nestedMarker, nestedSibling] of [
          ['-', '-'],
          ['1.', '2.'],
        ] as const) {
          const indent = ' '.repeat(parentMarker.length + 1);
          const source = [
            `${parentMarker} item`,
            '',
            `${indent}${directive}`,
            `${indent}${nestedMarker} x`,
            `${indent}${nestedSibling} y`,
            '',
            `${parentSibling} sibling`,
            '',
            `${indent}| a   | b   |`,
            `${indent}| --- | --- |`,
            '',
          ].join('\n');
          const builtin = await formatWithBuiltInPrettier(source, parser);
          const formatted = await prettier.format(source, {
            parser,
            plugins: [plugin],
          });

          expect(formatted, source).toBe(
            builtin.replace(/\| a +\| b +\|/, '| a | b |'),
          );
          expect(
            await prettier.format(formatted, { parser, plugins: [plugin] }),
            source,
          ).toBe(formatted);
        }
      }
    }
  });

  test('given a table is followed by an ATX-looking line with an inline-code pipe, when formatting, then leaves that line unchanged', async () => {
    const source = [
      '| A | B |',
      '| --- | --- |',
      '| one | two |',
      '# Heading | `a|b`',
      '',
    ].join('\n');
    const expected = await formatWithBuiltInPrettier(source);
    const actual = await formatWithPluginPrettierStyle(source);

    expect(actual).toBe(expected);
    expect(actual).not.toContain('`a\\|b`');
  });

  test('given ATX-looking rows can be mistaken for table starts or bodies, when formatting, then never inserts code-pipe escapes into them', async () => {
    const sources = [
      [
        '| Real | Table |',
        '| --- | --- |',
        '| one | two |',
        '# Heading | `a|b`',
        '',
      ].join('\n'),
      [
        '| Real | Table |',
        '| --- | --- |',
        '',
        '   ###### Heading | Note',
        '--- | ---',
        'value | `a|b`',
        '',
      ].join('\n'),
    ];

    for (const source of sources) {
      const expected = await formatWithBuiltInPrettier(source);
      const actual = await formatWithPluginPrettierStyle(source);

      expect(actual, source).toBe(expected);
      expect(actual, source).not.toContain('`a\\|b`');
    }
  });

  test('given hash text is not an ATX block start or is inside an outer pipe, when formatting, then still protects valid table code pipes', async () => {
    const source = [
      '| Name | Note |',
      '| --- | --- |',
      '| # pipe-wrapped | `a|b` |',
      '####### not-a-heading | `c|d`',
      '#not-a-heading | `e|f`',
      '\\# escaped-heading | `g|h`',
      '',
    ].join('\n');
    const validSource = source
      .replaceAll('|b`', '\\|b`')
      .replaceAll('|d`', '\\|d`')
      .replaceAll('|f`', '\\|f`')
      .replaceAll('|h`', '\\|h`');
    const expected = await formatWithBuiltInPrettier(validSource);
    const actual = await formatWithPluginPrettierStyle(source);

    expect(actual).toBe(expected);
  });

  test('given table-shaped sibling list items contain an inline-code pipe, when formatting, then leaves the list text unchanged', async () => {
    const source = [
      '| Real | Table |',
      '| --- | --- |',
      '',
      '- Name | Role',
      '- --- | ---',
      '- Value | `a|b`',
      '',
    ].join('\n');
    const expected = await formatWithBuiltInPrettier(source);
    const actual = await formatWithPluginPrettierStyle(source);

    expect(actual).toBe(expected);
    expect(actual).toContain('`a|b`');
  });

  test('given unordered and ordered sibling list items look like table rows, when formatting, then leaves every sibling item unchanged', async () => {
    const markers = ['-', '+', '*', '1.', '1)'] as const;

    for (const marker of markers) {
      const source = [
        '| Real | Table |',
        '| --- | --- |',
        '',
        `${marker} Name | Role`,
        `${marker} --- | ---`,
        `${marker} Value | \`a|b\``,
        '',
      ].join('\n');
      const expected = await formatWithBuiltInPrettier(source);
      const actual = await formatWithPluginPrettierStyle(source);

      expect(actual, source).toBe(expected);
      expect(actual, source).not.toContain('`a\\|b`');
    }
  });

  test('given a real table starts inside list containers, when formatting, then still protects its code pipes', async () => {
    const sources = [
      ['- Name | Role', '  --- | ---', '  Value | `a|b`', ''].join('\n'),
      ['- Name | Role', '  - | -', '  Value | `a|b`', ''].join('\n'),
      ['> 1. Name | Role', '>    - | -', '>    Value | `a|b`', ''].join('\n'),
      ['> 1. Name | Role', '>    --- | ---', '>    Value | `a|b`', ''].join(
        '\n',
      ),
    ];

    for (const source of sources) {
      const validSource = source.replace('`a|b`', '`a\\|b`');
      const expected = await formatWithBuiltInPrettier(validSource);
      const actual = await formatWithPluginPrettierStyle(source);

      expect(actual, source).toBe(expected);
    }
  });

  test('given prettier-ignore and a bare table are separated by a blockquote blank line, when formatting, then leaves the ignored table unchanged', async () => {
    const source = [
      '> <!-- prettier-ignore -->',
      '>',
      '> ID | Note',
      '> --- | ---',
      '> one | `a|b`',
      '',
    ].join('\n');
    const expected = await formatWithBuiltInPrettier(source);
    const actual = await formatWithPluginPrettierStyle(source);

    expect(actual).toBe(expected);
    expect(actual).toContain('`a|b`');
  });

  test('given prettier-ignore protects a bare table inside list or nested quote containers, when formatting, then leaves each table unchanged', async () => {
    const cases = [
      {
        parser: 'markdown',
        source: [
          '- <!-- prettier-ignore -->',
          '  ',
          '  ID | Note',
          '  --- | ---',
          '  one | `a|b`',
          '',
        ].join('\n'),
      },
      {
        parser: 'markdown',
        source: [
          '<!-- prettier-ignore -->',
          '- ID | Note',
          '  --- | ---',
          '  one | `a|b`',
          '',
        ].join('\n'),
      },
      {
        parser: 'markdown',
        source: [
          '<!-- prettier-ignore -->',
          '',
          '> ID | Note',
          '> --- | ---',
          '> one | `a|b`',
          '',
        ].join('\n'),
      },
      {
        parser: 'mdx',
        source: [
          '>> {/* prettier-ignore */}',
          '>>',
          '>> ID | Note',
          '>> --- | ---',
          '>> one | `a|b`',
          '',
        ].join('\n'),
      },
    ] as const;

    for (const testCase of cases) {
      const expected = await formatWithBuiltInPrettier(
        testCase.source,
        testCase.parser,
      );
      const actual = await formatWithPluginPrettierStyle(
        testCase.source,
        testCase.parser,
      );

      expect(actual, testCase.source).toBe(expected);
      expect(actual, testCase.source).toContain('`a|b`');
    }
  });

  test('given a physical blank line ends an ignored blockquote, when formatting, then protects code pipes in the later table', async () => {
    const source = [
      '> <!-- prettier-ignore -->',
      '',
      '> ID | Note',
      '> --- | ---',
      '> one | `a|b`',
      '',
    ].join('\n');
    const validSource = source.replace('`a|b`', '`a\\|b`');
    const expected = await formatWithBuiltInPrettier(validSource);
    const actual = await formatWithPluginPrettierStyle(source);

    expect(actual).toBe(expected);
    expect(actual).toContain('`a\\|b`');
  });
});

async function formatWithBuiltInPrettier(
  source: string,
  parser: 'markdown' | 'mdx' = 'markdown',
): Promise<string> {
  return prettier.format(source, {
    parser,
    plugins: [prettierMarkdownPlugin],
  });
}

async function formatWithPluginPrettierStyle(
  source: string,
  parser: 'markdown' | 'mdx' = 'markdown',
): Promise<string> {
  return prettier.format(source, {
    markdownTableStyle: 'prettier',
    parser,
    plugins: [plugin],
  });
}
