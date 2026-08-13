import * as prettier from 'prettier';
import * as prettierMarkdownPlugin from 'prettier/plugins/markdown';
import { describe, expect, test } from 'vitest';

import plugin from '../src/index.js';

describe('Markdown table parser preprocessing', () => {
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

      expect(actual).toBe(expected);
      expect(actual).not.toContain('`a\\|b`');
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

      expect(actual, marker).toBe(expected);
      expect(actual, marker).not.toContain('`a\\|b`');
    }
  });

  test('given a real table starts inside list containers, when formatting, then still protects its code pipes', async () => {
    const sources = [
      ['- Name | Role', '  --- | ---', '  Value | `a|b`', ''].join('\n'),
      ['> 1. Name | Role', '>    --- | ---', '>    Value | `a|b`', ''].join(
        '\n',
      ),
    ];

    for (const source of sources) {
      const validSource = source.replace('`a|b`', '`a\\|b`');
      const expected = await formatWithBuiltInPrettier(validSource);
      const actual = await formatWithPluginPrettierStyle(source);

      expect(actual).toBe(expected);
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
