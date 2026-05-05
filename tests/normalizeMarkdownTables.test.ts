import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { describe, expect, test } from 'vitest';

import {
  normalizeMarkdownTables,
  type NormalizeMarkdownTablesOptions,
} from '../src/normalizeMarkdownTables.js';
import { parseMarkdownTableRowInternal as parseMarkdownTableRow } from '../src/normalizer/tableRows.js';

const STRICT_PERFORMANCE_TEST_TIMEOUT_MS = 500;
const IS_STRICT_PERFORMANCE_TEST =
  process.env.NORMALIZE_MARKDOWN_TABLES_STRESS === '1';
const PERFORMANCE_TEST_TIMEOUT_MS = STRICT_PERFORMANCE_TEST_TIMEOUT_MS;
const NORMALIZE_FUZZ_SEED = 0x5eed_1026;

type SeededRandom = {
  readonly next: () => number;
};

function expectFastNormalization(
  markdown: string,
  maxDurationMs: number,
  options: NormalizeMarkdownTablesOptions = {},
): string {
  const start = IS_STRICT_PERFORMANCE_TEST ? performance.now() : undefined;
  const normalized = normalizeMarkdownTables(markdown, options);

  if (start !== undefined) {
    expectStressDurationBelow(
      performance.now() - start,
      maxDurationMs,
      markdown.length,
      countMarkdownLines(markdown),
    );
  }

  return normalized;
}

function expectStressDurationBelow(
  durationMs: number,
  maxDurationMs: number,
  inputSize: number,
  lineCount: number,
): void {
  if (durationMs >= maxDurationMs) {
    throw new Error(
      [
        `Expected normalization to finish within ${String(maxDurationMs)}ms.`,
        `Elapsed: ${durationMs.toFixed(1)}ms.`,
        `Input size: ${String(inputSize)} characters across ${String(
          lineCount,
        )} lines.`,
        'Stress mode: strict.',
      ].join(' '),
    );
  }
}

function normalizeMarkdownTablesFromUntypedOptions(
  markdown: string,
  options: Record<string, unknown>,
): unknown {
  return Reflect.apply(normalizeMarkdownTables, undefined, [markdown, options]);
}

function normalizeMarkdownTablesFromUntypedCall(
  markdown: unknown,
  options?: unknown,
): unknown {
  if (options === undefined) {
    return Reflect.apply(normalizeMarkdownTables, undefined, [markdown]);
  }

  return Reflect.apply(normalizeMarkdownTables, undefined, [markdown, options]);
}

function countMarkdownLines(markdown: string): number {
  if (markdown.length === 0) {
    return 0;
  }

  return markdown.split('\n').length;
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
    throw new Error(`Invalid fuzz fixture "${label}" — no values to pick.`);
  }

  return value;
}

describe('normalizeMarkdownTables', () => {
  test('given plain Markdown prose starts with export, when normalizing, then it normalizes the following table', () => {
    const markdown = [
      'export controls tell the editor what to show.',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        'export controls tell the editor what to show.',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given plain Markdown prose starts with import, when normalizing, then it normalizes the following table', () => {
    const markdown = [
      'import notes can be prose, not code.',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        'import notes can be prose, not code.',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given an inverted normalization range, when normalizing, then it throws a clear error', () => {
    const markdown = [
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(() =>
      normalizeMarkdownTables(markdown, { rangeEnd: 5, rangeStart: 10 }),
    ).toThrow(
      'Invalid normalization range: rangeStart "10" must be less than or equal to rangeEnd "5".',
    );
  });

  test('given no-pipe input and an invalid rangeStart, when normalizing, then it throws a clear error', () => {
    expect(() =>
      normalizeMarkdownTables('plain text', { rangeStart: -1 }),
    ).toThrow(
      'Invalid rangeStart "-1" — expected an integer between 0 and 10.',
    );
  });

  test('given no-pipe input and an inverted range, when normalizing, then it throws a clear error', () => {
    expect(() =>
      normalizeMarkdownTables('plain text', { rangeEnd: 5, rangeStart: 10 }),
    ).toThrow(
      'Invalid normalization range: rangeStart "10" must be less than or equal to rangeEnd "5".',
    );
  });

  test('given no-pipe input and a valid range, when normalizing, then it returns unchanged', () => {
    expect(
      normalizeMarkdownTables('plain text', { rangeEnd: 10, rangeStart: 0 }),
    ).toBe('plain text');
  });

  test('given non-string input from an untyped caller, when normalizing, then it throws a clear error', () => {
    expect(() => normalizeMarkdownTablesFromUntypedCall(null)).toThrow(
      'Invalid markdown input "null" - expected a string.',
    );
  });

  test('given non-string input has a hostile toString, when normalizing, then it does not call it', () => {
    const markdown = {
      toString() {
        throw new Error('toString should not be called.');
      },
    };

    expect(() => normalizeMarkdownTablesFromUntypedCall(markdown)).toThrow(
      'Invalid markdown input "object" - expected a string.',
    );
  });

  test('given null or non-object options from an untyped caller, when normalizing, then it throws a clear error', () => {
    expect(() =>
      normalizeMarkdownTablesFromUntypedCall('plain text', null),
    ).toThrow(
      'Invalid normalizeMarkdownTables options "null" - expected an object or undefined.',
    );

    expect(() =>
      normalizeMarkdownTablesFromUntypedCall('plain text', 7),
    ).toThrow(
      'Invalid normalizeMarkdownTables options "7" - expected an object or undefined.',
    );
  });

  test('given a typo option key from an untyped caller, when normalizing, then it throws a clear error', () => {
    expect(() =>
      normalizeMarkdownTablesFromUntypedOptions('plain text', {
        markdownTableStyles: 'compact',
      }),
    ).toThrow(
      'Invalid normalizeMarkdownTables option "markdownTableStyles" - expected one of "enableMdxEsm", "enableMdxJsx", "markdownTableStyle", "maxInputBytes", "rangeEnd", or "rangeStart".',
    );
  });

  test('given options inherit a table style, when normalizing, then it ignores the inherited option', () => {
    const markdown = [
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');
    const options: Record<string, unknown> = {};

    Object.setPrototypeOf(options, { markdownTableStyle: 'prettier' });

    expect(normalizeMarkdownTablesFromUntypedOptions(markdown, options)).toBe(
      ['| Name | Role |', '| --- | --- |', '| Davey | Builder |'].join('\n'),
    );
  });

  test('given options define a hostile table-style getter, when normalizing, then it ignores the accessor', () => {
    const markdown = [
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');
    const options: Record<string, unknown> = {};
    let wasGetterCalled = false;

    Object.defineProperty(options, 'markdownTableStyle', {
      get() {
        wasGetterCalled = true;
        throw new Error('getter should not be called.');
      },
    });

    expect(normalizeMarkdownTablesFromUntypedOptions(markdown, options)).toBe(
      ['| Name | Role |', '| --- | --- |', '| Davey | Builder |'].join('\n'),
    );
    expect(wasGetterCalled).toBe(false);
  });

  test('given an invalid table style from an untyped caller, when normalizing, then it throws a clear error', () => {
    const markdown = [
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(() =>
      normalizeMarkdownTablesFromUntypedOptions(markdown, {
        markdownTableStyle: 'wide',
      }),
    ).toThrow(
      'Invalid markdownTableStyle "wide" — expected "spaced", "compact", or "prettier".',
    );
  });

  test('given invalid MDX protection options from an untyped caller, when normalizing, then it throws clear errors', () => {
    expect(() =>
      normalizeMarkdownTablesFromUntypedOptions('plain text', {
        enableMdxEsm: 'true',
      }),
    ).toThrow('Invalid enableMdxEsm "true" — expected a boolean or undefined.');

    expect(() =>
      normalizeMarkdownTablesFromUntypedOptions('plain text', {
        enableMdxJsx: 1,
      }),
    ).toThrow('Invalid enableMdxJsx "1" — expected a boolean or undefined.');
  });

  test('given invalid max input byte options from an untyped caller, when normalizing, then it throws clear errors', () => {
    expect(() =>
      normalizeMarkdownTablesFromUntypedOptions('plain text', {
        maxInputBytes: -1,
      }),
    ).toThrow(
      'Invalid maxInputBytes "-1" — expected a safe whole number at or above 0, or undefined.',
    );

    expect(() =>
      normalizeMarkdownTablesFromUntypedOptions('plain text', {
        maxInputBytes: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(
      'Invalid maxInputBytes "Infinity" — expected a safe whole number at or above 0, or undefined.',
    );

    expect(() =>
      normalizeMarkdownTablesFromUntypedOptions('plain text', {
        maxInputBytes: '10',
      }),
    ).toThrow(
      'Invalid maxInputBytes "10" — expected a safe whole number at or above 0, or undefined.',
    );
  });

  test('given helper input is larger than maxInputBytes, when normalizing, then it throws before style shortcuts', () => {
    expect(() =>
      normalizeMarkdownTables('plain text', {
        markdownTableStyle: 'prettier',
        maxInputBytes: 4,
      }),
    ).toThrow(
      'Markdown input is too large: 10 bytes. Set maxInputBytes to at least 10 or pass smaller Markdown.',
    );
  });

  test('given helper input matches maxInputBytes, when normalizing, then it accepts the input', () => {
    const markdown = [
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(
      normalizeMarkdownTables(markdown, {
        maxInputBytes: Buffer.byteLength(markdown, 'utf8'),
      }),
    ).toBe(
      ['| Name | Role |', '| --- | --- |', '| Davey | Builder |'].join('\n'),
    );
  });

  test('given helper input has multi-byte text, when maxInputBytes is too low, then it counts UTF-8 bytes', () => {
    expect(() =>
      normalizeMarkdownTables('é', {
        maxInputBytes: 1,
      }),
    ).toThrow(
      'Markdown input is too large: 2 bytes. Set maxInputBytes to at least 2 or pass smaller Markdown.',
    );
  });

  test('given valid MDX protection options from an untyped caller, when normalizing, then it accepts them', () => {
    const markdown = [
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');
    const expected = [
      '| Name | Role |',
      '| --- | --- |',
      '| Davey | Builder |',
    ].join('\n');

    expect(
      normalizeMarkdownTablesFromUntypedOptions(markdown, {
        enableMdxEsm: undefined,
        enableMdxJsx: true,
      }),
    ).toBe(expected);

    expect(
      normalizeMarkdownTablesFromUntypedOptions(markdown, {
        enableMdxEsm: false,
        enableMdxJsx: false,
      }),
    ).toBe(expected);
  });

  test('given prettier style and invalid ranges, when normalizing, then it throws clear errors', () => {
    expect(() =>
      normalizeMarkdownTables('plain text', {
        markdownTableStyle: 'prettier',
        rangeStart: -1,
      }),
    ).toThrow(
      'Invalid rangeStart "-1" — expected an integer between 0 and 10.',
    );

    expect(() =>
      normalizeMarkdownTables('plain text', {
        markdownTableStyle: 'prettier',
        rangeEnd: 5,
        rangeStart: 10,
      }),
    ).toThrow(
      'Invalid normalization range: rangeStart "10" must be less than or equal to rangeEnd "5".',
    );
  });

  test('given a zero-length range inside a table, when normalizing, then it normalizes that table', () => {
    const markdown = [
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');
    const rangeStart = markdown.indexOf('Davey');

    expect(
      normalizeMarkdownTables(markdown, {
        rangeEnd: rangeStart,
        rangeStart,
      }),
    ).toBe(
      ['| Name | Role |', '| --- | --- |', '| Davey | Builder |'].join('\n'),
    );
  });

  test('given zero-length ranges at table boundaries, when normalizing, then it uses explicit table boundary rules', () => {
    const table = [
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');
    const markdown = ['Intro', '', table, '', 'Outro'].join('\n');
    const normalized = [
      'Intro',
      '',
      '| Name | Role |',
      '| --- | --- |',
      '| Davey | Builder |',
      '',
      'Outro',
    ].join('\n');
    const tableStart = markdown.indexOf('| Name');
    const insideHeaderText = markdown.indexOf('Name');
    const betweenHeaderAndDelimiter = markdown.indexOf('| -----');
    const tableEnd =
      markdown.indexOf('| Davey') + '| Davey | Builder     |'.length;
    const blankLineBeforeTable = markdown.indexOf('\n\n| Name') + 1;
    const blankLineAfterTable = tableEnd + 1;

    for (const rangeStart of [
      tableStart,
      insideHeaderText,
      betweenHeaderAndDelimiter,
      tableEnd,
    ]) {
      expect(
        normalizeMarkdownTables(markdown, {
          rangeEnd: rangeStart,
          rangeStart,
        }),
      ).toBe(normalized);
    }

    for (const rangeStart of [blankLineBeforeTable, blankLineAfterTable]) {
      expect(
        normalizeMarkdownTables(markdown, {
          rangeEnd: rangeStart,
          rangeStart,
        }),
      ).toBe(markdown);
    }
  });

  test('given a non-empty range starts after the final table row, when normalizing, then it leaves the table unchanged', () => {
    const markdown = [
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
      'Outro',
    ].join('\n');
    const normalized = [
      '| Name | Role |',
      '| --- | --- |',
      '| Davey | Builder |',
      '',
      'Outro',
    ].join('\n');
    const finalRowEnd =
      markdown.indexOf('| Davey') + '| Davey | Builder     |'.length;

    expect(
      normalizeMarkdownTables(markdown, {
        rangeEnd: finalRowEnd + 1,
        rangeStart: finalRowEnd,
      }),
    ).toBe(markdown);

    expect(
      normalizeMarkdownTables(markdown, {
        rangeEnd: finalRowEnd,
        rangeStart: finalRowEnd - 1,
      }),
    ).toBe(normalized);
  });

  test('given a document starts with a BOM before a root table, when normalizing, then it keeps the BOM and normalizes the table', () => {
    const bom = '\uFEFF';
    const markdown = [
      `${bom}| Name  | Role        |`,
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [`${bom}| Name | Role |`, '| --- | --- |', '| Davey | Builder |'].join(
        '\n',
      ),
    );
  });

  test('given a document starts with a BOM before front matter, when normalizing, then it keeps front matter protected', () => {
    const bom = '\uFEFF';
    const markdown = [
      `${bom}---`,
      'title: Roles',
      'table: |',
      '  | Name  | Role        |',
      '  | ----- | ----------- |',
      '  | Davey | Builder     |',
      '---',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        `${bom}---`,
        'title: Roles',
        'table: |',
        '  | Name  | Role        |',
        '  | ----- | ----------- |',
        '  | Davey | Builder     |',
        '---',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given a BOM appears before a later table row, when normalizing, then it is not treated as prefix whitespace', () => {
    const bom = '\uFEFF';
    const markdown = [
      'Intro',
      '',
      `${bom}| Name  | Role        |`,
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  test('given a document starts with a BOM before protected regions, when normalizing, then it keeps table-shaped text protected', () => {
    const bom = '\uFEFF';
    const cases: ReadonlyArray<{
      readonly label: string;
      readonly lines: ReadonlyArray<string>;
      readonly options?: NormalizeMarkdownTablesOptions;
    }> = [
      {
        label: 'fenced code block',
        lines: [
          `${bom}\`\`\`md`,
          '| Keep  | Fence |',
          '| ----- | ----- |',
          '| this  | text  |',
          '```',
        ],
      },
      {
        label: 'HTML comment',
        lines: [
          `${bom}<!--`,
          '| Keep  | Comment |',
          '| ----- | ------- |',
          '| this  | text    |',
          '-->',
        ],
      },
      {
        label: 'raw HTML block',
        lines: [
          `${bom}<pre>`,
          '| Keep  | HTML |',
          '| ----- | ---- |',
          '| this  | text |',
          '</pre>',
        ],
      },
      {
        label: 'listed HTML block',
        lines: [
          `${bom}<section>`,
          '| Keep  | HTML block |',
          '| ----- | ---------- |',
          '| this  | text       |',
          '</section>',
        ],
      },
      {
        label: 'prettier ignore directive',
        lines: [
          `${bom}<!-- prettier-ignore -->`,
          '| Keep  | Ignored |',
          '| ----- | ------- |',
          '| this  | text    |',
        ],
      },
      {
        label: 'MDX ESM block',
        lines: [
          `${bom}export const table = \``,
          '| Keep  | ESM  |',
          '| ----- | ---- |',
          '| this  | text |',
          '`;',
        ],
        options: { enableMdxEsm: true },
      },
      {
        label: 'MDX JSX block',
        lines: [
          `${bom}<Demo>`,
          '  | Keep  | JSX  |',
          '  | ----- | ---- |',
          '  | this  | text |',
          '</Demo>',
        ],
        options: { enableMdxJsx: true },
      },
    ];

    for (const protectedCase of cases) {
      const markdown = protectedCase.lines.join('\n');

      expect(
        normalizeMarkdownTables(markdown, protectedCase.options),
        protectedCase.label,
      ).toBe(markdown);
    }
  });

  test('given rangeEnd infinity, when normalizing, then it treats the range as ending at the document end', () => {
    const markdown = [
      'Intro',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(
      normalizeMarkdownTables(markdown, {
        rangeEnd: Number.POSITIVE_INFINITY,
        rangeStart: markdown.indexOf('| Name'),
      }),
    ).toBe(
      [
        'Intro',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given mixed line endings inside a table, when normalizing, then it preserves each line ending', () => {
    const markdown = [
      'Intro\r\n',
      '| Name  | Role        |\n',
      '| ----- | ----------- |\r\n',
      '| Davey | Builder     |\n',
      'Outro',
    ].join('');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        'Intro\r\n',
        '| Name | Role |\n',
        '| --- | --- |\r\n',
        '| Davey | Builder |\n',
        'Outro',
      ].join(''),
    );
  });

  test('given mixed line endings and a table range, when normalizing, then it uses the original offsets', () => {
    const markdown = [
      '| Name  | Role        |\r\n',
      '| ----- | ----------- |\n',
      '| Davey | Builder     |\r\n',
      '\n',
      '| Tool  | Use         |\r\n',
      '| ----- | ----------- |\n',
      '| Codex | Pair worker |\n',
    ].join('');
    const rangeStart = markdown.indexOf('| Tool');
    const rangeEnd =
      markdown.indexOf('| Codex') + '| Codex | Pair worker |'.length;

    expect(
      normalizeMarkdownTables(markdown, {
        rangeEnd,
        rangeStart,
      }),
    ).toBe(
      [
        '| Name  | Role        |\r\n',
        '| ----- | ----------- |\n',
        '| Davey | Builder     |\r\n',
        '\n',
        '| Tool | Use |\r\n',
        '| --- | --- |\n',
        '| Codex | Pair worker |\n',
      ].join(''),
    );
  });

  test('given thousands of unmatched backtick runs, when normalizing, then it stays fast', () => {
    const cell = Array.from({ length: 800 }, (_, index) =>
      '`'.repeat(index + 1),
    ).join(' ');
    const markdown = [
      '| Name | Note |',
      '| --- | --- |',
      `| Davey | ${cell} |`,
    ].join('\n');

    const normalized = expectFastNormalization(
      markdown,
      PERFORMANCE_TEST_TIMEOUT_MS,
    );

    expect(normalized).toContain(`| Davey | ${cell} |`);
  });

  test('given many code spans with pipes, when normalizing, then rendering stays fast', () => {
    const cell = Array.from(
      { length: 10_000 },
      (_, index) => `\`value ${index} | note\``,
    ).join(' ');
    const markdown = [
      '| Name | Note |',
      '| --- | --- |',
      `| Davey | ${cell} |`,
    ].join('\n');

    const normalized = expectFastNormalization(
      markdown,
      PERFORMANCE_TEST_TIMEOUT_MS,
    );

    expect(normalized).toContain('`value 9999 | note`');
  });

  test('given many table rows with code spans, when normalizing, then table block parsing stays fast', () => {
    const rows = Array.from(
      { length: 2_000 },
      (_, index) => `| Davey ${index} | \`value ${index} | note\` |`,
    );
    const markdown = ['| Name | Note |', '| --- | --- |', ...rows].join('\n');

    const normalized = expectFastNormalization(
      markdown,
      PERFORMANCE_TEST_TIMEOUT_MS,
    );

    expect(normalized).toContain('| Davey 1999 | `value 1999 | note` |');
  });

  test('given many escaped pipes, when normalizing, then scanning stays fast', () => {
    const cell = Array.from(
      { length: 12_000 },
      (_, index) => `value ${index}\\|note`,
    ).join(' ');
    const markdown = [
      '| Name | Note |',
      '| --- | --- |',
      `| Davey | ${cell} |`,
    ].join('\n');

    const normalized = expectFastNormalization(
      markdown,
      PERFORMANCE_TEST_TIMEOUT_MS,
    );

    expect(normalized).toContain('value 11999\\|note');
  });

  test('given many extra fragments with escaped pipes, when repairing, then it stays fast', () => {
    const fragments = Array.from(
      { length: 8_000 },
      (_, index) => ` part ${index}\\          `,
    ).join('|         ');
    const markdown = [
      '| Name | Note | Status |',
      '| --- | --- | --- |',
      `| Davey |${fragments}|         tail | kept |`,
    ].join('\n');

    const normalized = expectFastNormalization(
      markdown,
      PERFORMANCE_TEST_TIMEOUT_MS,
    );

    expect(normalized).toContain('part 7999\\|tail');
  });

  test('given many fragments after an open code span, when repairing, then it preserves the row quickly', () => {
    const fragments = Array.from(
      { length: 6_000 },
      (_, index) => ` fragment ${index}`,
    ).join(' |');
    const markdown = [
      '| Name | Note |',
      '| --- | --- |',
      `| Davey | \`${fragments} |`,
    ].join('\n');

    const normalized = expectFastNormalization(
      markdown,
      PERFORMANCE_TEST_TIMEOUT_MS,
    );

    expect(normalized).toBe(markdown);
  });

  test('given many malformed MDX JSX starts, when normalizing, then scanning stays fast', () => {
    const malformedJsxLines = Array.from({ length: 4_000 }, (_, index) => [
      `<Component${index} prop={value${index}`,
      '',
    ]).flat();
    const markdown = [
      ...malformedJsxLines,
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    const normalized = expectFastNormalization(
      markdown,
      PERFORMANCE_TEST_TIMEOUT_MS,
      { enableMdxJsx: true },
    );

    expect(normalized).toContain('<Component3999 prop={value3999');
    expect(normalized).toContain('| Name | Role |');
  });

  test('given one malformed MDX JSX start has many later greater-than lines, when normalizing, then scanning stays fast', () => {
    const laterGreaterThanLines = Array.from(
      { length: 12_000 },
      (_, index) => `line ${String(index)} >`,
    );
    const markdown = [
      '<Component prop={value',
      ...laterGreaterThanLines,
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    const normalized = expectFastNormalization(
      markdown,
      PERFORMANCE_TEST_TIMEOUT_MS,
      { enableMdxJsx: true },
    );

    expect(normalized).toContain('line 11999 >');
    expect(normalized).toContain('| Name | Role |');
  });

  test('given thousands of nested list table rows, when normalizing, then list context stays fast', () => {
    const rows = Array.from(
      { length: 6_000 },
      (_, index) => `    | Davey ${index}  | Builder     |`,
    );
    const markdown = [
      '- Work',
      '  - Roles',
      '',
      '    | Name  | Role        |',
      '    | ----- | ----------- |',
      ...rows,
    ].join('\n');

    const normalized = expectFastNormalization(
      markdown,
      PERFORMANCE_TEST_TIMEOUT_MS,
    );

    expect(normalized).toContain('| Davey 5999 | Builder |');
  });

  test('given seeded generated rows, when normalizing, then output is idempotent', () => {
    const random = createSeededRandom(NORMALIZE_FUZZ_SEED);
    const prefixes = ['', '> ', '  '];
    const cells = [
      'plain',
      'with spaces',
      String.raw`a\|b`,
      '`a | b`',
      String.raw`two\\slashes`,
      '*em*',
    ];

    for (let index = 0; index < 80; index++) {
      const prefix = pick(random, prefixes, 'prefix');
      const columnCount = 2 + randomInt(random, 4);
      const header = Array.from(
        { length: columnCount },
        (_, columnIndex) => `H${columnIndex}`,
      );
      const row = Array.from({ length: columnCount }, () =>
        pick(random, cells, 'cell'),
      );
      const markdown = [
        `${prefix}| ${header.join(' | ')} |`,
        `${prefix}| ${header.map(() => '---').join(' | ')} |`,
        `${prefix}| ${row.join(' | ')} |`,
      ].join('\n');
      const once = normalizeMarkdownTables(markdown);
      const twice = normalizeMarkdownTables(once);

      if (twice !== once) {
        throw new Error(
          [
            `Normalization was not idempotent for seed ${NORMALIZE_FUZZ_SEED} case ${index}.`,
            markdown,
            once,
            twice,
          ].join('\n---\n'),
        );
      }
    }
  });

  test('given seeded protected regions, when normalizing, then generated table text stays unchanged', () => {
    const random = createSeededRandom(NORMALIZE_FUZZ_SEED + 1);
    const fences = ['```', '~~~'];

    for (let index = 0; index < 24; index++) {
      const fence = pick(random, fences, 'fence');
      const width = 2 + randomInt(random, 4);
      const table = [
        `| ${Array.from(
          { length: width },
          (_, cellIndex) => `H${cellIndex}`,
        ).join(' | ')} |`,
        `| ${Array.from({ length: width }, () => '-----').join(' | ')} |`,
        `| ${Array.from(
          { length: width },
          (_, cellIndex) => `value ${cellIndex}`,
        ).join(' | ')} |`,
      ].join('\n');
      const markdown = [fence, table, fence].join('\n');
      const normalized = normalizeMarkdownTables(markdown);

      if (normalized !== markdown) {
        throw new Error(
          [
            `Protected region changed for seed ${
              NORMALIZE_FUZZ_SEED + 1
            } case ${index}.`,
            markdown,
            normalized,
          ].join('\n---\n'),
        );
      }
    }
  });

  test('given protected regions inside containers, when normalizing, then protected table text stays unchanged', () => {
    const normalTable = [
      '| Next  | Table |',
      '| ----- | ----- |',
      '| yes   | 1     |',
    ];
    const normalizedNormalTable = [
      '| Next | Table |',
      '| --- | --- |',
      '| yes | 1 |',
    ];
    const cases = [
      {
        label: 'blockquote fenced code',
        lines: [
          '> ```md',
          '> | A  | B  |',
          '> | --- | --- |',
          '> | x  | y  |',
          '> ```',
        ],
      },
      {
        label: 'second-level list fenced code',
        lines: [
          '- parent',
          '  - child',
          '      ```md',
          '      | A  | B  |',
          '      | --- | --- |',
          '      | x  | y  |',
          '      ```',
        ],
      },
      {
        label: 'blockquote HTML comment',
        lines: [
          '> <!--',
          '> | A  | B  |',
          '> | --- | --- |',
          '> | x  | y  |',
          '> -->',
        ],
      },
      {
        label: 'blockquote raw HTML',
        lines: [
          '> <pre>',
          '> | A  | B  |',
          '> | --- | --- |',
          '> | x  | y  |',
          '> </pre>',
        ],
      },
      {
        label: 'blockquote prettier ignore',
        lines: [
          '> <!-- prettier-ignore -->',
          '> | A  | B  |',
          '> | --- | --- |',
          '> | x  | y  |',
        ],
      },
      {
        label: 'blockquote list fenced code',
        lines: [
          '> - item',
          '>   ```md',
          '>   | A  | B  |',
          '>   | --- | --- |',
          '>   | x  | y  |',
          '>   ```',
        ],
      },
    ];

    for (const protectedCase of cases) {
      const markdown = [...protectedCase.lines, '', ...normalTable, ''].join(
        '\n',
      );

      expect(normalizeMarkdownTables(markdown), protectedCase.label).toBe(
        [...protectedCase.lines, '', ...normalizedNormalTable, ''].join('\n'),
      );
    }
  });

  test('given blockquoted protected regions have blank marker lines, when normalizing, then protected table text stays unchanged', () => {
    const cases = [
      {
        label: 'blockquote fenced code',
        lines: [
          '> ```md',
          '>',
          '> | A  | B  |',
          '> | --- | --- |',
          '> | x  | y  |',
          '> ```',
        ],
      },
      {
        label: 'nested blockquote fenced code',
        lines: [
          '>> ```md',
          '>>',
          '>> | A  | B  |',
          '>> | --- | --- |',
          '>> | x  | y  |',
          '>> ```',
        ],
      },
      {
        label: 'blockquote HTML comment',
        lines: [
          '> <!--',
          '>',
          '> | A  | B  |',
          '> | --- | --- |',
          '> | x  | y  |',
          '> -->',
        ],
      },
      {
        label: 'blockquote raw HTML',
        lines: [
          '> <pre>',
          '>',
          '> | A  | B  |',
          '> | --- | --- |',
          '> | x  | y  |',
          '> </pre>',
        ],
      },
      {
        label: 'blockquote prettier ignore range',
        lines: [
          '> <!-- prettier-ignore-start -->',
          '>',
          '> | A  | B  |',
          '> | --- | --- |',
          '> | x  | y  |',
          '> <!-- prettier-ignore-end -->',
        ],
      },
    ];

    for (const protectedCase of cases) {
      const markdown = protectedCase.lines.join('\n');

      expect(normalizeMarkdownTables(markdown), protectedCase.label).toBe(
        markdown,
      );
    }
  });

  test('given Markdown tables adjacent to protected region boundaries, when normalizing, then only outside tables change', () => {
    const cases = [
      {
        expected: [
          '---',
          'table: |',
          '  | Keep  | Front matter |',
          '  | ----- | ------------ |',
          '  | this  | text         |',
          '---',
          '| After | Table |',
          '| --- | --- |',
          '| yes | 1 |',
        ],
        label: 'front matter before table',
        source: [
          '---',
          'table: |',
          '  | Keep  | Front matter |',
          '  | ----- | ------------ |',
          '  | this  | text         |',
          '---',
          '| After  | Table       |',
          '| ------ | ----------- |',
          '| yes    | 1           |',
        ],
      },
      {
        expected: [
          '| Before | Table |',
          '| --- | --- |',
          '| yes | 1 |',
          '```markdown',
          '| Keep  | Fence |',
          '| ----- | ----- |',
          '| this  | text  |',
          '```',
          '| After | Table |',
          '| --- | --- |',
          '| yes | 1 |',
        ],
        label: 'fenced code between tables',
        source: [
          '| Before | Table       |',
          '| ------ | ----------- |',
          '| yes    | 1           |',
          '```markdown',
          '| Keep  | Fence |',
          '| ----- | ----- |',
          '| this  | text  |',
          '```',
          '| After  | Table       |',
          '| ------ | ----------- |',
          '| yes    | 1           |',
        ],
      },
      {
        expected: [
          '| Before | Table |',
          '| --- | --- |',
          '| yes | 1 |',
          '<!--',
          '| Keep  | Comment |',
          '| ----- | ------- |',
          '| this  | text    |',
          '-->',
          '| After | Table |',
          '| --- | --- |',
          '| yes | 1 |',
        ],
        label: 'HTML comment between tables',
        source: [
          '| Before | Table       |',
          '| ------ | ----------- |',
          '| yes    | 1           |',
          '<!--',
          '| Keep  | Comment |',
          '| ----- | ------- |',
          '| this  | text    |',
          '-->',
          '| After  | Table       |',
          '| ------ | ----------- |',
          '| yes    | 1           |',
        ],
      },
      {
        expected: [
          '| Before | Table |',
          '| --- | --- |',
          '| yes | 1 |',
          '<script>',
          'const table = `',
          '| Keep  | Script |',
          '| ----- | ------ |',
          '| this  | text   |',
          '`;',
          '</script>',
          '| After | Table |',
          '| --- | --- |',
          '| yes | 1 |',
        ],
        label: 'raw HTML between tables',
        source: [
          '| Before | Table       |',
          '| ------ | ----------- |',
          '| yes    | 1           |',
          '<script>',
          'const table = `',
          '| Keep  | Script |',
          '| ----- | ------ |',
          '| this  | text   |',
          '`;',
          '</script>',
          '| After  | Table       |',
          '| ------ | ----------- |',
          '| yes    | 1           |',
        ],
      },
      {
        expected: [
          '| Before | Table |',
          '| --- | --- |',
          '| yes | 1 |',
          '<!-- prettier-ignore-start -->',
          '| Keep  | Ignored |',
          '| ----- | ------- |',
          '| this  | text    |',
          '<!-- prettier-ignore-end -->',
          '| After | Table |',
          '| --- | --- |',
          '| yes | 1 |',
        ],
        label: 'prettier-ignore range between tables',
        source: [
          '| Before | Table       |',
          '| ------ | ----------- |',
          '| yes    | 1           |',
          '<!-- prettier-ignore-start -->',
          '| Keep  | Ignored |',
          '| ----- | ------- |',
          '| this  | text    |',
          '<!-- prettier-ignore-end -->',
          '| After  | Table       |',
          '| ------ | ----------- |',
          '| yes    | 1           |',
        ],
      },
    ];

    for (const protectedCase of cases) {
      expect(
        normalizeMarkdownTables(protectedCase.source.join('\n')),
        protectedCase.label,
      ).toBe(protectedCase.expected.join('\n'));
    }
  });

  test('given MDX tables adjacent to protected region boundaries, when normalizing, then only outside tables change', () => {
    const cases = [
      {
        expected: [
          '| Before | Table |',
          '| --- | --- |',
          '| yes | 1 |',
          'export const table = `',
          '| Keep  | ESM  |',
          '| ----- | ---- |',
          '| this  | text |',
          '`;',
          '| After | Table |',
          '| --- | --- |',
          '| yes | 1 |',
        ],
        label: 'MDX ESM between tables',
        source: [
          '| Before | Table       |',
          '| ------ | ----------- |',
          '| yes    | 1           |',
          'export const table = `',
          '| Keep  | ESM  |',
          '| ----- | ---- |',
          '| this  | text |',
          '`;',
          '| After  | Table       |',
          '| ------ | ----------- |',
          '| yes    | 1           |',
        ],
      },
      {
        expected: [
          '| Before | Table |',
          '| --- | --- |',
          '| yes | 1 |',
          '<Demo>',
          '  | Keep  | JSX  |',
          '  | ----- | ---- |',
          '  | this  | text |',
          '</Demo>',
          '| After | Table |',
          '| --- | --- |',
          '| yes | 1 |',
        ],
        label: 'MDX JSX between tables',
        source: [
          '| Before | Table       |',
          '| ------ | ----------- |',
          '| yes    | 1           |',
          '<Demo>',
          '  | Keep  | JSX  |',
          '  | ----- | ---- |',
          '  | this  | text |',
          '</Demo>',
          '| After  | Table       |',
          '| ------ | ----------- |',
          '| yes    | 1           |',
        ],
      },
    ];

    for (const protectedCase of cases) {
      expect(
        normalizeMarkdownTables(protectedCase.source.join('\n'), {
          enableMdxEsm: true,
          enableMdxJsx: true,
        }),
        protectedCase.label,
      ).toBe(protectedCase.expected.join('\n'));
    }
  });

  test('given ranges inside protected regions, when normalizing, then protected table text stays unchanged', () => {
    const cases: ReadonlyArray<{
      readonly label: string;
      readonly lines: ReadonlyArray<string>;
      readonly options?: NormalizeMarkdownTablesOptions;
    }> = [
      {
        label: 'fenced code',
        lines: [
          '```md',
          '| Keep  | Fence |',
          '| ----- | ----- |',
          '| this  | text  |',
          '```',
          '',
          '| After  | Table      |',
          '| ------ | ---------- |',
          '| normal | unchanged |',
        ],
      },
      {
        label: 'indented code',
        lines: [
          '    | Keep  | Indent |',
          '    | ----- | ------ |',
          '    | this  | text   |',
          '',
          '| After  | Table      |',
          '| ------ | ---------- |',
          '| normal | unchanged |',
        ],
      },
      {
        label: 'HTML comment',
        lines: [
          '<!--',
          '| Keep  | Comment |',
          '| ----- | ------- |',
          '| this  | text    |',
          '-->',
          '',
          '| After  | Table      |',
          '| ------ | ---------- |',
          '| normal | unchanged |',
        ],
      },
      {
        label: 'raw HTML',
        lines: [
          '<script>',
          'const table = `',
          '| Keep  | Script |',
          '| ----- | ------ |',
          '| this  | text   |',
          '`;',
          '</script>',
          '',
          '| After  | Table      |',
          '| ------ | ---------- |',
          '| normal | unchanged |',
        ],
      },
      {
        label: 'prettier-ignore range',
        lines: [
          '<!-- prettier-ignore-start -->',
          '| Keep  | Ignored |',
          '| ----- | ------- |',
          '| this  | text    |',
          '<!-- prettier-ignore-end -->',
          '',
          '| After  | Table      |',
          '| ------ | ---------- |',
          '| normal | unchanged |',
        ],
      },
      {
        label: 'MDX ESM',
        lines: [
          'export const table = `',
          '| Keep  | ESM  |',
          '| ----- | ---- |',
          '| this  | text |',
          '`;',
          '',
          '| After  | Table      |',
          '| ------ | ---------- |',
          '| normal | unchanged |',
        ],
        options: { enableMdxEsm: true },
      },
      {
        label: 'MDX JSX',
        lines: [
          '<Demo>',
          '  | Keep  | JSX  |',
          '  | ----- | ---- |',
          '  | this  | text |',
          '</Demo>',
          '',
          '| After  | Table      |',
          '| ------ | ---------- |',
          '| normal | unchanged |',
        ],
        options: { enableMdxJsx: true },
      },
    ];

    for (const protectedCase of cases) {
      const markdown = protectedCase.lines.join('\n');
      const rangeStart = markdown.indexOf('Keep');
      const rangeEnd = markdown.indexOf('text') + 'text'.length;

      expect(
        normalizeMarkdownTables(markdown, {
          ...protectedCase.options,
          rangeEnd,
          rangeStart,
        }),
        protectedCase.label,
      ).toBe(markdown);
    }
  });

  test('given ranges end inside protected regions, when normalizing, then earlier selected tables collapse and protected text stays unchanged', () => {
    const beforeTable = [
      '| Before | Table       |',
      '| ------ | ----------- |',
      '| yes    | 1           |',
    ];
    const expectedBeforeTable = [
      '| Before | Table |',
      '| --- | --- |',
      '| yes | 1 |',
    ];
    const cases: ReadonlyArray<{
      readonly label: string;
      readonly options?: NormalizeMarkdownTablesOptions;
      readonly protectedLines: ReadonlyArray<string>;
    }> = [
      {
        label: 'fenced code',
        protectedLines: [
          '```md',
          '| Keep  | Fence |',
          '| ----- | ----- |',
          '| this  | text  |',
          '```',
        ],
      },
      {
        label: 'indented code',
        protectedLines: [
          '    | Keep  | Indent |',
          '    | ----- | ------ |',
          '    | this  | text   |',
        ],
      },
      {
        label: 'HTML comment',
        protectedLines: [
          '<!--',
          '| Keep  | Comment |',
          '| ----- | ------- |',
          '| this  | text    |',
          '-->',
        ],
      },
      {
        label: 'raw HTML',
        protectedLines: [
          '<script>',
          'const table = `',
          '| Keep  | Script |',
          '| ----- | ------ |',
          '| this  | text   |',
          '`;',
          '</script>',
        ],
      },
      {
        label: 'prettier-ignore range',
        protectedLines: [
          '<!-- prettier-ignore-start -->',
          '| Keep  | Ignored |',
          '| ----- | ------- |',
          '| this  | text    |',
          '<!-- prettier-ignore-end -->',
        ],
      },
      {
        label: 'MDX ESM',
        options: { enableMdxEsm: true },
        protectedLines: [
          'export const table = `',
          '| Keep  | ESM  |',
          '| ----- | ---- |',
          '| this  | text |',
          '`;',
        ],
      },
      {
        label: 'MDX JSX',
        options: { enableMdxJsx: true },
        protectedLines: [
          '<Demo>',
          '  | Keep  | JSX  |',
          '  | ----- | ---- |',
          '  | this  | text |',
          '</Demo>',
        ],
      },
    ];

    for (const protectedCase of cases) {
      const markdown = [
        ...beforeTable,
        '',
        ...protectedCase.protectedLines,
      ].join('\n');
      const rangeStart = markdown.indexOf('| Before');
      const rangeEnd = markdown.indexOf('text') + 'text'.length;

      expect(
        normalizeMarkdownTables(markdown, {
          ...protectedCase.options,
          rangeEnd,
          rangeStart,
        }),
        protectedCase.label,
      ).toBe(
        [...expectedBeforeTable, '', ...protectedCase.protectedLines].join(
          '\n',
        ),
      );
    }
  });

  test('given ranges select tables adjacent to protected regions, when normalizing, then only selected tables collapse', () => {
    const selectedTable = [
      '| Pick  | Value       |',
      '| ----- | ----------- |',
      '| yes   | 1           |',
    ];
    const expectedSelectedTable = [
      '| Pick | Value |',
      '| --- | --- |',
      '| yes | 1 |',
    ];
    const cases: ReadonlyArray<{
      readonly label: string;
      readonly options?: NormalizeMarkdownTablesOptions;
      readonly protectedLines: ReadonlyArray<string>;
    }> = [
      {
        label: 'fenced code',
        protectedLines: [
          '```md',
          '| Keep  | Fence |',
          '| ----- | ----- |',
          '| this  | text  |',
          '```',
        ],
      },
      {
        label: 'indented code',
        protectedLines: [
          '    | Keep  | Indent |',
          '    | ----- | ------ |',
          '    | this  | text   |',
        ],
      },
      {
        label: 'HTML comment',
        protectedLines: [
          '<!--',
          '| Keep  | Comment |',
          '| ----- | ------- |',
          '| this  | text    |',
          '-->',
        ],
      },
      {
        label: 'raw HTML',
        protectedLines: [
          '<script>',
          'const table = `',
          '| Keep  | Script |',
          '| ----- | ------ |',
          '| this  | text   |',
          '`;',
          '</script>',
        ],
      },
      {
        label: 'prettier-ignore range',
        protectedLines: [
          '<!-- prettier-ignore-start -->',
          '| Keep  | Ignored |',
          '| ----- | ------- |',
          '| this  | text    |',
          '<!-- prettier-ignore-end -->',
        ],
      },
      {
        label: 'MDX ESM',
        options: { enableMdxEsm: true },
        protectedLines: [
          'export const table = `',
          '| Keep  | ESM  |',
          '| ----- | ---- |',
          '| this  | text |',
          '`;',
        ],
      },
      {
        label: 'MDX JSX',
        options: { enableMdxJsx: true },
        protectedLines: [
          '<Demo>',
          '  | Keep  | JSX  |',
          '  | ----- | ---- |',
          '  | this  | text |',
          '</Demo>',
        ],
      },
    ];

    for (const protectedCase of cases) {
      const markdown = [
        ...protectedCase.protectedLines,
        '',
        ...selectedTable,
      ].join('\n');
      const rangeStart = markdown.indexOf('| Pick');
      const rangeEnd = markdown.length;

      expect(
        normalizeMarkdownTables(markdown, {
          ...protectedCase.options,
          rangeEnd,
          rangeStart,
        }),
        protectedCase.label,
      ).toBe(
        [...protectedCase.protectedLines, '', ...expectedSelectedTable].join(
          '\n',
        ),
      );
    }
  });

  test('given seeded ambiguous extra cells, when normalizing, then rows are preserved', () => {
    const random = createSeededRandom(NORMALIZE_FUZZ_SEED + 2);
    const endings = ['real extra', String.raw`literal\ `, '`open'];

    for (let index = 0; index < 40; index++) {
      const ending = pick(random, endings, 'ending');
      const markdown = [
        '| Name | Note |',
        '| --- | --- |',
        `| Davey | ${ending} | ${randomInt(random, 1_000)} |`,
      ].join('\n');
      const normalized = normalizeMarkdownTables(markdown);

      if (normalized !== markdown) {
        throw new Error(
          [
            `Ambiguous row changed for seed ${
              NORMALIZE_FUZZ_SEED + 2
            } case ${index}.`,
            markdown,
            normalized,
          ].join('\n---\n'),
        );
      }
    }
  });

  test('given a stress table with thousands of cells, when normalizing, then it remains idempotent', () => {
    const columnCount = 1_200;
    const header = Array.from(
      { length: columnCount },
      (_, index) => `H${index}`,
    );
    const values = Array.from({ length: columnCount }, (_, index) =>
      index % 2 === 0 ? `value ${index}` : String.raw`a\|b`,
    );
    const markdown = [
      `| ${header.join(' | ')} |`,
      `| ${header.map(() => '---').join(' | ')} |`,
      `| ${values.join(' | ')} |`,
    ].join('\n');
    const once = normalizeMarkdownTables(markdown);

    expect(normalizeMarkdownTables(once)).toBe(once);
    expect(
      parseMarkdownTableRow(once.split('\n')[2] ?? '')?.cells,
    ).toHaveLength(columnCount);
  });

  test('given MDX ESM uses semicolons, when normalizing with MDX ESM enabled, then it protects the ESM line only', () => {
    const markdown = [
      'export const sample = `| Code  | Meaning |`;',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown, { enableMdxEsm: true })).toBe(
      [
        'export const sample = `| Code  | Meaning |`;',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given MDX ESM has no semicolon, when normalizing with MDX ESM enabled, then it protects the ESM line only', () => {
    const markdown = [
      'export const sample = `| Code  | Meaning |`',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown, { enableMdxEsm: true })).toBe(
      [
        'export const sample = `| Code  | Meaning |`',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given multiline MDX ESM, when normalizing with MDX ESM enabled, then it protects the whole declaration', () => {
    const markdown = [
      'export const sample = {',
      '  value: `',
      '| Code  | Meaning |',
      '| ----- | ------- |',
      '| a     | b       |',
      '  `,',
      '}',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown, { enableMdxEsm: true })).toBe(
      [
        'export const sample = {',
        '  value: `',
        '| Code  | Meaning |',
        '| ----- | ------- |',
        '| a     | b       |',
        '  `,',
        '}',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given multiline MDX ESM uses trailing expression operators, when normalizing with MDX ESM enabled, then it protects the whole expression', () => {
    const markdown = [
      'export const sample =',
      '  first +',
      '  second.',
      '    value &&',
      '  third ||',
      '  fallback ??',
      '  source?.',
      '    table ??',
      '  `',
      '| Code  | Meaning |',
      '| ----- | ------- |',
      '| a     | b       |',
      '  `',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown, { enableMdxEsm: true })).toBe(
      [
        'export const sample =',
        '  first +',
        '  second.',
        '    value &&',
        '  third ||',
        '  fallback ??',
        '  source?.',
        '    table ??',
        '  `',
        '| Code  | Meaning |',
        '| ----- | ------- |',
        '| a     | b       |',
        '  `',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given MDX ESM line comments contain braces and backticks, when normalizing with MDX ESM enabled, then later tables still collapse', () => {
    const markdown = [
      'export const brace = 1; // {',
      'export const tick = 2; // `',
      'export const pattern = /{/;',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown, { enableMdxEsm: true })).toBe(
      [
        'export const brace = 1; // {',
        'export const tick = 2; // `',
        'export const pattern = /{/;',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given multiline MDX ESM has block comments and regex literals, when normalizing with MDX ESM enabled, then template table strings stay protected', () => {
    const markdown = [
      'export const sample = {',
      '  note: "comment and regex braces stay inside JavaScript",',
      '  comment: /* } */ "done",',
      '  pattern: /}/,',
      '  value: `',
      '| Code  | Meaning |',
      '| ----- | ------- |',
      '| a     | b       |',
      '  `,',
      '}',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown, { enableMdxEsm: true })).toBe(
      [
        'export const sample = {',
        '  note: "comment and regex braces stay inside JavaScript",',
        '  comment: /* } */ "done",',
        '  pattern: /}/,',
        '  value: `',
        '| Code  | Meaning |',
        '| ----- | ------- |',
        '| a     | b       |',
        '  `,',
        '}',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given TypeScript-style MDX ESM exports, when normalizing with MDX ESM enabled, then table-shaped strings stay protected', () => {
    const markdown = [
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
    ].join('\n');

    expect(normalizeMarkdownTables(markdown, { enableMdxEsm: true })).toBe(
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
      ].join('\n'),
    );
  });

  test('given unclosed MDX ESM is followed by a later section, when normalizing with MDX ESM enabled, then later Markdown tables still collapse', () => {
    const markdown = [
      'export const sample = {',
      '  table: `',
      '| Code  | Meaning |',
      '| ----- | ------- |',
      '| keep  | spacing |',
      '',
      '## Later',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown, { enableMdxEsm: true })).toBe(
      [
        'export const sample = {',
        '  table: `',
        '| Code  | Meaning |',
        '| ----- | ------- |',
        '| keep  | spacing |',
        '',
        '## Later',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given ESM-like blockquote or list prose is followed by root tables, when normalizing with MDX ESM enabled, then later root tables still collapse', () => {
    const cases = [
      {
        label: 'blockquote prose',
        lines: [
          '> export const sample = {',
          '| Name  | Role        |',
          '| ----- | ----------- |',
          '| Davey | Builder     |',
        ],
      },
      {
        label: 'list prose',
        lines: [
          '- import Demo from "./Demo"',
          '| Name  | Role        |',
          '| ----- | ----------- |',
          '| Davey | Builder     |',
        ],
      },
    ];

    for (const mdxCase of cases) {
      expect(
        normalizeMarkdownTables(mdxCase.lines.join('\n'), {
          enableMdxEsm: true,
        }),
        mdxCase.label,
      ).toBe(
        [
          mdxCase.lines[0],
          '| Name | Role |',
          '| --- | --- |',
          '| Davey | Builder |',
        ].join('\n'),
      );
    }
  });

  test('given unclosed root MDX ESM reaches a blockquote table, when normalizing with MDX ESM enabled, then the blockquote table still collapses', () => {
    const markdown = [
      'export const sample = {',
      '> | Name  | Role        |',
      '> | ----- | ----------- |',
      '> | Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown, { enableMdxEsm: true })).toBe(
      [
        'export const sample = {',
        '> | Name | Role |',
        '> | --- | --- |',
        '> | Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given unsupported export declare syntax, when normalizing with MDX ESM enabled, then it does not protect later Markdown tables', () => {
    const markdown = [
      'export declare sample = {',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown, { enableMdxEsm: true })).toBe(
      [
        'export declare sample = {',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given an MDX flow expression contains table-shaped strings, when normalizing with MDX ESM enabled, then it protects the expression', () => {
    const expressionLines = [
      '{',
      '  const table = `',
      '  | A    | B        |',
      '  | ---- | -------- |',
      '  | keep | spacing  |',
      '  `;',
      '  const nested = {',
      '    value: "brace } in string",',
      '    template: `brace } in text ${"{ still stringy }"}`,',
      '  };',
      '  /* } in a block comment should not close the expression. */',
      '  // } in a line comment should not close the expression',
      '  table;',
      '}',
    ];
    const markdown = [
      '| Before  | Table      |',
      '| ------- | ---------- |',
      '| normal  | collapses  |',
      '',
      ...expressionLines,
      '',
      '| After  | Table      |',
      '| ------ | ---------- |',
      '| normal | collapses  |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown, { enableMdxEsm: true })).toBe(
      [
        '| Before | Table |',
        '| --- | --- |',
        '| normal | collapses |',
        '',
        ...expressionLines,
        '',
        '| After | Table |',
        '| --- | --- |',
        '| normal | collapses |',
      ].join('\n'),
    );
  });

  test('given an MDX flow expression contains a regex brace, when normalizing with MDX ESM enabled, then it protects table-shaped strings until the real closing brace', () => {
    const expressionLines = [
      '{',
      '  const pattern = /[}/]\\//;',
      '  const table = `',
      '  | A    | B        |',
      '  | ---- | -------- |',
      '  | keep | spacing  |',
      '  `;',
      '  table;',
      '}',
    ];
    const markdown = [
      ...expressionLines,
      '',
      '| After  | Table      |',
      '| ------ | ---------- |',
      '| normal | collapses  |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown, { enableMdxEsm: true })).toBe(
      [
        ...expressionLines,
        '',
        '| After | Table |',
        '| --- | --- |',
        '| normal | collapses |',
      ].join('\n'),
    );
  });

  test('given unclosed MDX flow expression is followed by a later section, when normalizing with MDX ESM enabled, then later Markdown tables still collapse', () => {
    const markdown = [
      '{',
      '  const table = `',
      '  | A    | B        |',
      '  | ---- | -------- |',
      '  | keep | spacing  |',
      '  `;',
      '  table;',
      '',
      '## Later',
      '',
      '| After  | Table      |',
      '| ------ | ---------- |',
      '| normal | collapses  |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown, { enableMdxEsm: true })).toBe(
      [
        '{',
        '  const table = `',
        '  | A    | B        |',
        '  | ---- | -------- |',
        '  | keep | spacing  |',
        '  `;',
        '  table;',
        '',
        '## Later',
        '',
        '| After | Table |',
        '| --- | --- |',
        '| normal | collapses |',
      ].join('\n'),
    );
  });

  test('given a row with trailing spaces, tabs, and CR, when parsing, then trailing pipe detection preserves whitespace rules', () => {
    expect(parseMarkdownTableRow('|\tA\t|\tB\t|\t\r')).toEqual({
      balanced: true,
      cells: ['\tA\t', '\tB\t'],
      content: '|\tA\t|\tB\t|\t\r',
      delimiterPositions: [4],
      fragments: ['\tA\t', '\tB\t'],
      hasTrailingPipe: true,
      prefix: '',
      rawDelimiterPositions: [4],
    });
  });

  test('given a long pipe-heavy row, when parsing, then it reports every cell without rescanning suffixes', () => {
    const cellCount = 2_000;
    const row = `|${Array.from(
      { length: cellCount },
      (_, index) => `c${String(index)}`,
    ).join('|')}|`;
    const parsed = parseMarkdownTableRow(row);

    expect(parsed?.cells).toHaveLength(cellCount);
    expect(parsed?.fragments).toHaveLength(cellCount);
    expect(parsed?.hasTrailingPipe).toBe(true);
  });

  test('given a large file without pipes, when normalizing, then it returns the original text unchanged', () => {
    const markdown = Array.from(
      { length: 5_000 },
      (_, index) => `Paragraph ${String(index)} has no table markers.`,
    ).join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  test('given pipe-heavy prose without tables, when normalizing, then it stays fast', () => {
    const markdown = `${Array.from(
      { length: 12_000 },
      (_, index) => `line ${index} has | prose | pipes but no delimiter row`,
    ).join('\n')}\n`;

    const normalized = expectFastNormalization(
      markdown,
      PERFORMANCE_TEST_TIMEOUT_MS,
    );

    expect(normalized).toBe(markdown);
  });

  test('given a tiny range in pipe-heavy prose, when normalizing, then it stays fast', () => {
    const lines = Array.from(
      { length: 12_000 },
      (_, index) => `line ${index} has | prose | pipes but no delimiter row`,
    );
    const targetLine = 10_000;
    const markdown = `${lines.join('\n')}\n`;
    const targetText = `line ${targetLine}`;
    const rangeStart = markdown.indexOf(targetText);
    const rangeEnd = rangeStart + targetText.length;

    const normalized = expectFastNormalization(
      markdown,
      PERFORMANCE_TEST_TIMEOUT_MS,
      {
        rangeEnd,
        rangeStart,
      },
    );

    expect(normalized).toBe(markdown);
  });

  test('given a Prettier-aligned table, when normalizing, then writes one-space cells', () => {
    const markdown = [
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '| Codex | Pair worker |',
      '',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '| Codex | Pair worker |',
        '',
      ].join('\n'),
    );
  });

  test('given aligned separator cells, when normalizing, then keeps alignment markers', () => {
    const markdown = [
      '| Left | Right | Center |',
      '| :--- | ----: | :----: |',
      '| a | b | c |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '| Left | Right | Center |',
        '| :--- | ---: | :---: |',
        '| a | b | c |',
      ].join('\n'),
    );
  });

  test('given empty header and body cells, when normalizing spaced tables, then keeps the empty columns visible', () => {
    const markdown = [
      '|      | Name  |      |',
      '| ---- | ----- | ---- |',
      '|      | Davey |      |',
      '| one  |       | two  |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '|  | Name |  |',
        '| --- | --- | --- |',
        '|  | Davey |  |',
        '| one |  | two |',
      ].join('\n'),
    );
  });

  test('given empty header and body cells, when normalizing compact tables, then keeps the empty columns visible', () => {
    const markdown = [
      '|      | Name  |      |',
      '| ---- | ----- | ---- |',
      '|      | Davey |      |',
      '| one  |       | two  |',
    ].join('\n');

    expect(
      normalizeMarkdownTables(markdown, { markdownTableStyle: 'compact' }),
    ).toBe(['||Name||', '|---|---|---|', '||Davey||', '|one||two|'].join('\n'));
  });

  test('given a bare GFM table, when normalizing, then leaves it unchanged', () => {
    const markdown = [
      'Name  | Role',
      '----- | -----------',
      'Davey | Builder',
      '',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  test('given pipe-shaped prose without wrapped rows, when normalizing, then leaves it unchanged', () => {
    const markdown = [
      'This paragraph mentions A | B.',
      '--- | not a delimiter',
      'It keeps going | as prose.',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  test('given a valid one-column table, when normalizing, then writes one-space cells', () => {
    const markdown = ['| Name  |', '| ----- |', '| Davey |'].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      ['| Name |', '| --- |', '| Davey |'].join('\n'),
    );
  });

  test('given a short row, when normalizing, then pads missing cells', () => {
    const markdown = [
      '| A | B | C |',
      '| --- | --- | --- |',
      '| one | two |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      ['| A | B | C |', '| --- | --- | --- |', '| one | two |  |'].join('\n'),
    );
  });

  test('given a row missing multiple trailing cells, when normalizing spaced tables, then pads every missing cell', () => {
    const markdown = [
      '| Left | Right | Center | Plain |',
      '| :--- | ---: | :---: | --- |',
      '| one | two |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '| Left | Right | Center | Plain |',
        '| :--- | ---: | :---: | --- |',
        '| one | two |  |  |',
      ].join('\n'),
    );
  });

  test('given a row missing multiple trailing cells, when normalizing compact tables, then pads every missing cell', () => {
    const markdown = [
      '| Left | Right | Center | Plain |',
      '| :--- | ---: | :---: | --- |',
      '| one | two |',
    ].join('\n');

    expect(
      normalizeMarkdownTables(markdown, { markdownTableStyle: 'compact' }),
    ).toBe(
      [
        '|Left|Right|Center|Plain|',
        '|:---|---:|:---:|---|',
        '|one|two|||',
      ].join('\n'),
    );
  });

  test('given a row split by a code pipe, when normalizing, then repairs it from the header count', () => {
    const markdown = [
      '| Pattern | Meaning |',
      '| --- | --- |',
      '| `foo | bar` | example |',
    ].join('\n');
    const originalRow = parseMarkdownTableRow('| `foo | bar` | example |');
    const normalized = normalizeMarkdownTables(markdown);
    const normalizedRow = parseMarkdownTableRow('| `foo | bar` | example |');

    expect(normalized).toBe(
      [
        '| Pattern | Meaning |',
        '| --- | --- |',
        '| `foo | bar` | example |',
      ].join('\n'),
    );
    expect(normalizedRow?.cells).toHaveLength(originalRow?.cells.length ?? 0);
  });

  test('given an overwide row, when normalizing, then preserves the extra real cell', () => {
    const markdown = [
      '| Name | Note |',
      '| --- | --- |',
      '| Davey | Builder | Writer |',
    ].join('\n');

    const normalized = normalizeMarkdownTables(markdown);
    const originalRow = parseMarkdownTableRow('| Davey | Builder | Writer |');
    const normalizedRow = parseMarkdownTableRow('| Davey | Builder | Writer |');

    expect(normalized).toBe(markdown);
    expect(normalizedRow?.cells).toHaveLength(originalRow?.cells.length ?? 0);
  });

  test('given a literal trailing backslash before an extra cell, when normalizing, then preserves the row', () => {
    const markdown = [
      '| Name | Note |',
      '| --- | --- |',
      '| Davey | Builder\\ | Writer |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  test('given a final cell has a Prettier-aligned escaped pipe, when normalizing, then repairs that final cell', () => {
    const markdown = [
      '| Name | Note |',
      '| --- | --- |',
      '| Davey | Builder\\          |          Writer |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      ['| Name | Note |', '| --- | --- |', '| Davey | Builder\\|Writer |'].join(
        '\n',
      ),
    );
  });

  test('given an extra real cell with aligned columns, when normalizing spaced tables, then preserves that row', () => {
    const markdown = [
      '| Left | Right | Center | Plain |',
      '| :--- | ---: | :---: | --- |',
      '| a | b | c | d | e |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '| Left | Right | Center | Plain |',
        '| :--- | ---: | :---: | --- |',
        '| a | b | c | d | e |',
      ].join('\n'),
    );
  });

  test('given an extra real cell with aligned columns, when normalizing compact tables, then preserves that row', () => {
    const markdown = [
      '| Left | Right | Center | Plain |',
      '| :--- | ---: | :---: | --- |',
      '| a | b | c | d | e |',
    ].join('\n');

    expect(
      normalizeMarkdownTables(markdown, { markdownTableStyle: 'compact' }),
    ).toBe(
      [
        '|Left|Right|Center|Plain|',
        '|:---|---:|:---:|---|',
        '| a | b | c | d | e |',
      ].join('\n'),
    );
  });

  test('given a row split by an odd escaped pipe, when normalizing, then repaired output keeps the same cells', () => {
    const markdown = [
      '| Value | Note |',
      '| --- | --- |',
      '| foo\\          |          bar | kept |',
    ].join('\n');
    const normalized = normalizeMarkdownTables(markdown);
    const normalizedRow = parseMarkdownTableRow('| foo\\|bar | kept |');

    expect(normalized).toBe(
      ['| Value | Note |', '| --- | --- |', '| foo\\|bar | kept |'].join('\n'),
    );
    expect(normalizedRow?.cells).toEqual([' foo\\|bar ', ' kept ']);
  });

  test('given a header split by an odd escaped pipe, when normalizing, then repaired output keeps the same cells', () => {
    const markdown = [
      '| Value\\          |          Note | Role |',
      '| --- | --- |',
      '| Davey | Builder |',
    ].join('\n');
    const normalized = normalizeMarkdownTables(markdown);
    const normalizedHeader = parseMarkdownTableRow('| Value\\|Note | Role |');

    expect(normalized).toBe(
      ['| Value\\|Note | Role |', '| --- | --- |', '| Davey | Builder |'].join(
        '\n',
      ),
    );
    expect(normalizedHeader?.cells).toEqual([' Value\\|Note ', ' Role ']);
  });

  test('given compact style and a header split by an odd escaped pipe, when normalizing, then repaired output keeps the same cells', () => {
    const markdown = [
      '| Value\\          |          Note | Role |',
      '| --- | --- |',
      '| Davey | Builder |',
    ].join('\n');

    expect(
      normalizeMarkdownTables(markdown, { markdownTableStyle: 'compact' }),
    ).toBe(['|Value\\|Note|Role|', '|---|---|', '|Davey|Builder|'].join('\n'));
  });

  test('given a header with an extra real cell, when normalizing, then preserves the table', () => {
    const markdown = [
      '| Value | Note | Role |',
      '| --- | --- |',
      '| Davey | Builder |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  test('given a header with a code span pipe, when normalizing, then keeps the code cell intact', () => {
    const markdown = [
      '| `foo | bar` | Meaning |',
      '| --- | --- |',
      '| literal | example |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '| `foo | bar` | Meaning |',
        '| --- | --- |',
        '| literal | example |',
      ].join('\n'),
    );
  });

  test('given a header with an unclosed code span, when normalizing, then preserves the whole block', () => {
    const markdown = [
      '| `Name | Role |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  test('given an unmatched code span and pipe, when normalizing, then preserves the row', () => {
    const markdown = [
      '| Pattern | Meaning |',
      '| --- | --- |',
      '| `foo | bar | example |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  test('given ambiguous extra pipes, when normalizing, then preserves the row', () => {
    const markdown = [
      '| Name | Note |',
      '| --- | --- |',
      '| Davey | Builder | Writer | Speaker |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  test('given a final-cell escaped-pipe repair plus an unrelated extra cell, when normalizing spaced tables, then preserves that row', () => {
    const markdown = [
      '| Name | Note |',
      '| --- | --- |',
      '| Davey | Builder\\          |          Writer | Speaker |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  test('given a final-cell escaped-pipe repair plus an unrelated extra cell, when normalizing compact tables, then preserves that row', () => {
    const markdown = [
      '| Name | Note |',
      '| --- | --- |',
      '| Davey | Builder\\          |          Writer | Speaker |',
    ].join('\n');

    expect(
      normalizeMarkdownTables(markdown, { markdownTableStyle: 'compact' }),
    ).toBe(
      [
        '|Name|Note|',
        '|---|---|',
        '| Davey | Builder\\          |          Writer | Speaker |',
      ].join('\n'),
    );
  });

  test('given a one-column final cell has a Prettier-padded escaped pipe, when normalizing, then repairs that final cell', () => {
    const markdown = [
      '| Note |',
      '| --- |',
      '| Builder\\          |          Writer |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      ['| Note |', '| --- |', '| Builder\\|Writer |'].join('\n'),
    );
  });

  test('given a multi-column final cell has a Prettier-padded escaped pipe, when normalizing compact tables, then repairs that final cell', () => {
    const markdown = [
      '| Name | Note |',
      '| --- | --- |',
      '| Davey | Builder\\          |          Writer |',
    ].join('\n');

    expect(
      normalizeMarkdownTables(markdown, { markdownTableStyle: 'compact' }),
    ).toBe(['|Name|Note|', '|---|---|', '|Davey|Builder\\|Writer|'].join('\n'));
  });

  test('given a final-cell code span pipe, when normalizing, then repairs that final cell', () => {
    const markdown = [
      '| Name | Note |',
      '| --- | --- |',
      '| Davey | `Builder | Writer` |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '| Name | Note |',
        '| --- | --- |',
        '| Davey | `Builder | Writer` |',
      ].join('\n'),
    );
  });

  test('given a row with a missing trailing pipe, when normalizing, then preserves that row', () => {
    const markdown = [
      '| Name  | Note    |',
      '| ----- | ------- |',
      '| Davey | Builder',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      ['| Name | Note |', '| --- | --- |', '| Davey | Builder'].join('\n'),
    );
  });

  test('given a padded pipe inside inline code, when normalizing, then preserves the code exactly', () => {
    const markdown = [
      '| Code |',
      '| --- |',
      '| `foo          |          bar` |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      ['| Code |', '| --- |', '| `foo          |          bar` |'].join('\n'),
    );
  });

  test('given inline code pipes with different spacing, when normalizing, then preserves each literal', () => {
    const markdown = [
      '| Code |',
      '| --- |',
      '| `foo|bar` |',
      '| `foo | bar` |',
      '| `foo  |  bar` |',
      '| `foo\t|\tbar` |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  test('given double-backtick code spans with single backticks and pipes, when normalizing, then keeps pipes in the code cell', () => {
    const markdown = [
      '| Code | Note |',
      '| --- | --- |',
      '| ``foo ` | ` bar`` | kept |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  test('given a backslash before a closing backtick inside code, when normalizing, then treats the following pipe as a delimiter', () => {
    const markdown = [
      '| First | Second | Third |',
      '| --- | --- | --- |',
      '| `a \\` | b | c` |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  test('given a backslash before a backtick outside code, when normalizing, then it does not open code', () => {
    const markdown = [
      '| Code | Note |',
      '| --- | --- |',
      '| \\`not code | value |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  test('given odd and even backslashes before backticks, when parsing, then only odd backslashes escape the opener', () => {
    const oddBackslashes = parseMarkdownTableRow('| \\`not code | value |');
    const evenBackslashes = parseMarkdownTableRow(
      '| \\\\`code | span` | value |',
    );

    expect(oddBackslashes?.balanced).toBe(true);
    expect(oddBackslashes?.cells).toEqual([' \\`not code ', ' value ']);
    expect(oddBackslashes?.delimiterPositions).toEqual([13]);

    expect(evenBackslashes?.balanced).toBe(true);
    expect(evenBackslashes?.cells).toEqual([' \\\\`code | span` ', ' value ']);
    expect(evenBackslashes?.delimiterPositions).toEqual([18]);
  });

  test('given a backslash before a closing backtick inside code, when parsing, then the matching run still closes the span', () => {
    const row = parseMarkdownTableRow('| `a \\` | b | c |');

    expect(row?.balanced).toBe(true);
    expect(row?.cells).toEqual([' `a \\` ', ' b ', ' c ']);
    expect(row?.delimiterPositions).toEqual([8, 12]);
  });

  test('given mixed single and double backtick spans, when parsing, then only equal-length runs close each span', () => {
    const row = parseMarkdownTableRow('| ``a ` | b`` | `c `` | d` |');

    expect(row?.balanced).toBe(true);
    expect(row?.cells).toEqual([' ``a ` | b`` ', ' `c `` | d` ']);
    expect(row?.delimiterPositions).toEqual([14]);
  });

  test('given unmatched backticks with pipes, when parsing, then it reports the row as unbalanced', () => {
    const row = parseMarkdownTableRow('| \\\\`open | code | value |');

    expect(row?.balanced).toBe(false);
    expect(row?.cells).toEqual([' \\\\`open ', ' code ', ' value ']);
    expect(row?.delimiterPositions).toEqual([10, 17]);
  });

  test('given odd and even backslashes before backticks, when normalizing, then it keeps GFM table cells intact', () => {
    const markdown = [
      '| Code | Note |',
      '| --- | --- |',
      '| \\`not code | value |',
      '| \\\\`code | span` | value |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '| Code | Note |',
        '| --- | --- |',
        '| \\`not code | value |',
        '| \\\\`code | span` | value |',
      ].join('\n'),
    );
  });

  test('given inline code pipes, when normalizing twice, then output does not drift', () => {
    const markdown = [
      '| Code |',
      '| --- |',
      '| `foo  |  bar` |',
      '| `foo\t|\tbar` |',
    ].join('\n');
    const once = normalizeMarkdownTables(markdown);

    expect(normalizeMarkdownTables(once)).toBe(once);
  });

  test('given an escaped pipe padded by Prettier, when normalizing, then it stays in one cell', () => {
    const markdown = [
      '| Value | Note |',
      '| --- | --- |',
      '| foo\\          |          bar | kept |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      ['| Value | Note |', '| --- | --- |', '| foo\\|bar | kept |'].join('\n'),
    );
  });

  test('given compact style and an escaped pipe padded by Prettier, when normalizing, then it stays in one cell', () => {
    const markdown = [
      '| Value | Note |',
      '| --- | --- |',
      '| foo\\          |          bar | kept |',
    ].join('\n');

    expect(
      normalizeMarkdownTables(markdown, { markdownTableStyle: 'compact' }),
    ).toBe(['|Value|Note|', '|---|---|', '|foo\\|bar|kept|'].join('\n'));
  });

  test('given an escaped pipe with one intentional space on each side, when normalizing, then it keeps those spaces', () => {
    const markdown = [
      '| Value | Note |',
      '| --- | --- |',
      '| foo \\          |          bar | kept |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      ['| Value | Note |', '| --- | --- |', '| foo \\| bar | kept |'].join(
        '\n',
      ),
    );
  });

  test('given compact style and an escaped pipe with one intentional space on each side, when normalizing, then it keeps those spaces', () => {
    const markdown = [
      '| Value | Note |',
      '| --- | --- |',
      '| foo \\          |          bar | kept |',
    ].join('\n');

    expect(
      normalizeMarkdownTables(markdown, { markdownTableStyle: 'compact' }),
    ).toBe(['|Value|Note|', '|---|---|', '|foo \\| bar|kept|'].join('\n'));
  });

  test('given an escaped pipe with multiple intentional spaces, when normalizing, then it keeps those spaces', () => {
    const markdown = [
      '| Value | Note |',
      '| --- | --- |',
      '| foo  \\          |          bar | kept |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      ['| Value | Note |', '| --- | --- |', '| foo  \\|  bar | kept |'].join(
        '\n',
      ),
    );
  });

  test('given one to four backslashes before pipes, when parsing, then odd counts escape the pipe', () => {
    const oneBackslash = parseMarkdownTableRow(String.raw`| a\|b | note |`);
    const twoBackslashes = parseMarkdownTableRow(String.raw`| a\\|b | note |`);
    const threeBackslashes = parseMarkdownTableRow(
      String.raw`| a\\\|b | note |`,
    );
    const fourBackslashes = parseMarkdownTableRow(
      String.raw`| a\\\\|b | note |`,
    );

    expect(oneBackslash?.cells).toEqual([String.raw` a\|b `, ' note ']);
    expect(oneBackslash?.delimiterPositions).toEqual([7]);

    expect(twoBackslashes?.cells).toEqual([String.raw` a\\`, 'b ', ' note ']);
    expect(twoBackslashes?.delimiterPositions).toEqual([5, 8]);

    expect(threeBackslashes?.cells).toEqual([String.raw` a\\\|b `, ' note ']);
    expect(threeBackslashes?.delimiterPositions).toEqual([9]);

    expect(fourBackslashes?.cells).toEqual([
      String.raw` a\\\\`,
      'b ',
      ' note ',
    ]);
    expect(fourBackslashes?.delimiterPositions).toEqual([7, 10]);
  });

  test('given one to four backslashes before pipes, when normalizing, then only odd counts keep the pipe in the cell', () => {
    const markdown = [
      '| Value | Next | Note |',
      '| --- | --- | --- |',
      String.raw`| a\|b | note |`,
      String.raw`| a\\|b | note |`,
      String.raw`| a\\\|b | note |`,
      String.raw`| a\\\\|b | note |`,
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '| Value | Next | Note |',
        '| --- | --- | --- |',
        String.raw`| a\|b | note |  |`,
        String.raw`| a\\ | b | note |`,
        String.raw`| a\\\|b | note |  |`,
        String.raw`| a\\\\ | b | note |`,
      ].join('\n'),
    );
  });

  test('given even backslashes before a padded pipe, when normalizing, then preserves the backslashes and spacing', () => {
    const markdown = [
      '| Name | Note |',
      '| --- | --- |',
      '| Davey | path\\\\          |          segment |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  test('given a final overflow cell has a Prettier-padded escaped pipe, when normalizing, then repairs that final cell', () => {
    const markdown = [
      '| A | B | C |',
      '| --- | --- | --- |',
      '| one | two | path\\          |          three |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '| A | B | C |',
        '| --- | --- | --- |',
        '| one | two | path\\|three |',
      ].join('\n'),
    );
  });

  test('given compact style, when normalizing, then removes table cell padding', () => {
    const markdown = ['| A | B |', '| --- | :---: |', '| one | two |'].join(
      '\n',
    );

    expect(
      normalizeMarkdownTables(markdown, { markdownTableStyle: 'compact' }),
    ).toBe(['|A|B|', '|---|:---:|', '|one|two|'].join('\n'));
  });

  test('given prettier style, when normalizing, then leaves the markdown unchanged', () => {
    const markdown = ['| A   | B   |', '| --- | --- |', '| one | two |'].join(
      '\n',
    );

    expect(
      normalizeMarkdownTables(markdown, { markdownTableStyle: 'prettier' }),
    ).toBe(markdown);
  });

  test('given CRLF input with a final newline, when normalizing, then preserves CRLF', () => {
    const markdown = [
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
    ].join('\r\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      ['| Name | Role |', '| --- | --- |', '| Davey | Builder |', ''].join(
        '\r\n',
      ),
    );
  });

  test('given CRLF input without a final newline, when normalizing, then preserves CRLF', () => {
    const markdown = [
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\r\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      ['| Name | Role |', '| --- | --- |', '| Davey | Builder |'].join('\r\n'),
    );
  });

  test('given CR-only input, when normalizing, then preserves CR-only line endings', () => {
    const markdown = [
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
    ].join('\r');

    expect(normalizeMarkdownTables(markdown)).toBe(
      ['| Name | Role |', '| --- | --- |', '| Davey | Builder |', ''].join(
        '\r',
      ),
    );
  });

  test('given table-shaped fenced code, when normalizing, then leaves the code unchanged', () => {
    const markdown = [
      '```markdown',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '```',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '```markdown',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '```',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given fenced code contains blockquote list table text, when normalizing, then leaves the code unchanged', () => {
    const markdown = [
      '```text',
      '> - Roles',
      '>   | Name  | Role        |',
      '>   | ----- | ----------- |',
      '>   | Davey | Builder     |',
      '```',
      '',
      '> - Roles',
      '>   | Name  | Role        |',
      '>   | ----- | ----------- |',
      '>   | Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '```text',
        '> - Roles',
        '>   | Name  | Role        |',
        '>   | ----- | ----------- |',
        '>   | Davey | Builder     |',
        '```',
        '',
        '> - Roles',
        '>   | Name | Role |',
        '>   | --- | --- |',
        '>   | Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given table-shaped indented code, when normalizing, then leaves the code unchanged', () => {
    const markdown = [
      '    | Name  | Role        |',
      '    | ----- | ----------- |',
      '    | Davey | Builder     |',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '    | Name  | Role        |',
        '    | ----- | ----------- |',
        '    | Davey | Builder     |',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given root indented code contains blockquote-shaped table rows, when normalizing, then leaves the code unchanged', () => {
    const markdown = [
      '    > | Name  | Role        |',
      '    > | ----- | ----------- |',
      '    > | Davey | Builder     |',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '    > | Name  | Role        |',
        '    > | ----- | ----------- |',
        '    > | Davey | Builder     |',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given table-shaped code indented with spaces and tabs, when normalizing, then leaves the code unchanged', () => {
    const markdown = [
      '  \t| Name  | Role        |',
      '  \t| ----- | ----------- |',
      '  \t| Davey | Builder     |',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '  \t| Name  | Role        |',
        '  \t| ----- | ----------- |',
        '  \t| Davey | Builder     |',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given a fence-shaped code block indented with spaces and tabs, when normalizing, then leaves the code unchanged', () => {
    const markdown = [
      '  \t```markdown',
      '  \t| Name  | Role        |',
      '  \t| ----- | ----------- |',
      '  \t| Davey | Builder     |',
      '  \t```',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '  \t```markdown',
        '  \t| Name  | Role        |',
        '  \t| ----- | ----------- |',
        '  \t| Davey | Builder     |',
        '  \t```',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given table-shaped front matter, when normalizing, then leaves the front matter unchanged', () => {
    const markdown = [
      '---',
      'title: Example',
      'body: |',
      '  | Name  | Role        |',
      '  | ----- | ----------- |',
      '  | Davey | Builder     |',
      '---',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '---',
        'title: Example',
        'body: |',
        '  | Name  | Role        |',
        '  | ----- | ----------- |',
        '  | Davey | Builder     |',
        '---',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given YAML front matter closes with a document end marker, when normalizing, then protects front matter and normalizes later tables', () => {
    const markdown = [
      '---',
      'title: Example',
      'body: |',
      '  | Name  | Role        |',
      '  | ----- | ----------- |',
      '  | Davey | Builder     |',
      '...',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '---',
        'title: Example',
        'body: |',
        '  | Name  | Role        |',
        '  | ----- | ----------- |',
        '  | Davey | Builder     |',
        '...',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given front matter with an indented delimiter in a literal block, when normalizing, then keeps all front matter unchanged', () => {
    const markdown = [
      '---',
      'title: Example',
      'description: |',
      '  ---',
      '  | Name  | Role        |',
      '  | ----- | ----------- |',
      '  | Davey | Builder     |',
      '---',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '---',
        'title: Example',
        'description: |',
        '  ---',
        '  | Name  | Role        |',
        '  | ----- | ----------- |',
        '  | Davey | Builder     |',
        '---',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given YAML front matter starts with comments and blanks, when normalizing, then leaves the front matter unchanged', () => {
    const markdown = [
      '---',
      '',
      '# Page settings',
      '',
      'title: Example',
      'body: |',
      '  | Name  | Role        |',
      '  | ----- | ----------- |',
      '  | Davey | Builder     |',
      '---',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '---',
        '',
        '# Page settings',
        '',
        'title: Example',
        'body: |',
        '  | Name  | Role        |',
        '  | ----- | ----------- |',
        '  | Davey | Builder     |',
        '---',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given YAML front matter uses root arrays and quoted keys, when normalizing, then leaves the front matter unchanged', () => {
    const markdown = [
      '---',
      '- "label": Roles',
      '  "body": |',
      '    | Name  | Role        |',
      '    | ----- | ----------- |',
      '    | Davey | Builder     |',
      '---',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '---',
        '- "label": Roles',
        '  "body": |',
        '    | Name  | Role        |',
        '    | ----- | ----------- |',
        '    | Davey | Builder     |',
        '---',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given YAML front matter uses directives, root scalars, and anchors, when normalizing, then leaves the front matter unchanged', () => {
    const cases = [
      [
        '---',
        '%YAML 1.2',
        '|',
        '  | Directive | Value     |',
        '  | --------- | --------- |',
        '  | keep      | spacing   |',
        '---',
      ],
      [
        '---',
        '|',
        '  | Scalar | Value     |',
        '  | ------ | --------- |',
        '  | keep   | spacing   |',
        '---',
      ],
      [
        '---',
        '&roles |',
        '  | Anchor | Value     |',
        '  | ------ | --------- |',
        '  | keep   | spacing   |',
        '---',
      ],
    ];

    for (const frontMatterLines of cases) {
      const markdown = [
        ...frontMatterLines,
        '',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
      ].join('\n');

      expect(normalizeMarkdownTables(markdown)).toBe(
        [
          ...frontMatterLines,
          '',
          '| Name | Role |',
          '| --- | --- |',
          '| Davey | Builder |',
        ].join('\n'),
      );
    }
  });

  test('given empty and comments-only front matter, when normalizing, then it still normalizes later tables', () => {
    const markdown = [
      '---',
      '---',
      '',
      '+++',
      '# Page settings',
      '# | Comment | Table |',
      '+++',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '---',
        '---',
        '',
        '+++',
        '# Page settings',
        '# | Comment | Table |',
        '+++',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given TOML front matter with table-shaped text, when normalizing, then leaves the front matter unchanged', () => {
    const markdown = [
      '+++',
      'title = "Example"',
      'body = """',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '"""',
      '+++',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '+++',
        'title = "Example"',
        'body = """',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '"""',
        '+++',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given TOML array table front matter, when normalizing, then leaves the front matter unchanged', () => {
    const markdown = [
      '+++',
      '[[menu.main]]',
      'name = "Roles"',
      'body = """',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '"""',
      '+++',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '+++',
        '[[menu.main]]',
        'name = "Roles"',
        'body = """',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '"""',
        '+++',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given Markdown starts with a thematic break, when normalizing, then it does not protect later tables', () => {
    const markdown = [
      '---',
      '',
      'Opening paragraph.',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
      '---',
      '',
      '| Tool  | Use         |',
      '| ----- | ----------- |',
      '| Codex | Pair worker |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '---',
        '',
        'Opening paragraph.',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '',
        '---',
        '',
        '| Tool | Use |',
        '| --- | --- |',
        '| Codex | Pair worker |',
      ].join('\n'),
    );
  });

  test('given Markdown starts with a thematic break and has a document end marker, when normalizing, then it does not protect later tables', () => {
    const markdown = [
      '---',
      '',
      'Opening paragraph.',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
      '...',
      '',
      '| Tool  | Use         |',
      '| ----- | ----------- |',
      '| Codex | Pair worker |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '---',
        '',
        'Opening paragraph.',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '',
        '...',
        '',
        '| Tool | Use |',
        '| --- | --- |',
        '| Codex | Pair worker |',
      ].join('\n'),
    );
  });

  test('given Markdown starts with thematic prose, when normalizing, then it does not treat the prose as front matter', () => {
    const markdown = [
      '---',
      'Opening paragraph.',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
      '---',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '---',
        'Opening paragraph.',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '',
        '---',
      ].join('\n'),
    );
  });

  test('given table-shaped HTML, when normalizing, then leaves the HTML unchanged', () => {
    const markdown = [
      '<!--',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '-->',
      '',
      '<pre>',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '</pre>',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '<!--',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '-->',
        '',
        '<pre>',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '</pre>',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given a multiline HTML comment closes on a content line, when normalizing, then later tables still collapse', () => {
    const markdown = [
      '<!--',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      'comment closes here --> trailing text',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '<!--',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        'comment closes here --> trailing text',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given table-shaped custom HTML, when normalizing, then leaves the HTML block unchanged', () => {
    const markdown = [
      '<my-widget data-kind="roles">',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '</my-widget>',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '<my-widget data-kind="roles">',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '</my-widget>',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given listed HTML block tags have attributes, when normalizing, then leaves the HTML block unchanged and collapses later tables', () => {
    const markdown = [
      '<section data-kind="roles" data-rule="score > 10">',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '</section>',
      '',
      '| After | Table       |',
      '| ----- | ----------- |',
      '| yes   | 1           |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '<section data-kind="roles" data-rule="score > 10">',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '</section>',
        '',
        '| After | Table |',
        '| --- | --- |',
        '| yes | 1 |',
      ].join('\n'),
    );
  });

  test('given closing listed HTML tags start a block, when normalizing, then leaves the HTML block unchanged and collapses later tables', () => {
    const markdown = [
      '</section>',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
      '| After | Table       |',
      '| ----- | ----------- |',
      '| yes   | 1           |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '</section>',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '',
        '| After | Table |',
        '| --- | --- |',
        '| yes | 1 |',
      ].join('\n'),
    );
  });

  test('given custom HTML attributes contain angle brackets, when normalizing, then leaves the HTML block unchanged', () => {
    const markdown = [
      '<my-widget data-rule="score > 10" data-template="<role-card />">',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '</my-widget>',
      '',
      'Intro paragraph',
      '<my-widget data-rule="score > 10" data-template="<role-card />">',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '<my-widget data-rule="score > 10" data-template="<role-card />">',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '</my-widget>',
        '',
        'Intro paragraph',
        '<my-widget data-rule="score > 10" data-template="<role-card />">',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given custom HTML block tags use blank-line boundaries, when normalizing, then leaves uninterrupted blocks unchanged and collapses tables after a blank boundary', () => {
    const markdown = [
      '<my-widget data-kind="roles">',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '</my-widget>',
      '',
      '<my-widget data-kind="empty">',
      '',
      '| After | Table       |',
      '| ----- | ----------- |',
      '| yes   | 1           |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '<my-widget data-kind="roles">',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '</my-widget>',
        '',
        '<my-widget data-kind="empty">',
        '',
        '| After | Table |',
        '| --- | --- |',
        '| yes | 1 |',
      ].join('\n'),
    );
  });

  test('given textarea contains table-shaped text after a blank line, when normalizing, then leaves textarea content unchanged', () => {
    const markdown = [
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
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '<textarea>',
        '',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '</textarea>',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given raw HTML closing tags use casing or whitespace, when normalizing, then following tables still collapse', () => {
    const markdown = [
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
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '<pre>',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '</PRE>',
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
      ].join('\n'),
    );
  });

  test('given a custom HTML tag inside a paragraph, when normalizing, then it does not start an HTML block', () => {
    const markdown = [
      'Intro paragraph',
      '<my-widget>',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        'Intro paragraph',
        '<my-widget>',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given HTML declarations and processing instructions before tables, when normalizing, then following tables collapse', () => {
    const markdown = [
      '<!doctype html>',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
      '<?xml version="1.0"?>',
      '| Tool  | Use         |',
      '| ----- | ----------- |',
      '| Codex | Pair worker |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '<!doctype html>',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '',
        '<?xml version="1.0"?>',
        '| Tool | Use |',
        '| --- | --- |',
        '| Codex | Pair worker |',
      ].join('\n'),
    );
  });

  test('given CDATA contains table-shaped text, when normalizing, then CDATA stays protected until its terminator', () => {
    const markdown = [
      '<![CDATA[',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      ']]>',
      '| Tool  | Use         |',
      '| ----- | ----------- |',
      '| Codex | Pair worker |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '<![CDATA[',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        ']]>',
        '| Tool | Use |',
        '| --- | --- |',
        '| Codex | Pair worker |',
      ].join('\n'),
    );
  });

  test('given table-shaped MDX JSX, when normalizing with MDX JSX enabled, then leaves the JSX unchanged', () => {
    const markdown = [
      '<Example',
      '  code={`',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '`}',
      '/>',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown, { enableMdxJsx: true })).toBe(
      [
        '<Example',
        '  code={`',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '`}',
        '/>',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given a table under a list item, when normalizing, then keeps the table in the list', () => {
    const markdown = [
      '- Roles',
      '  | Name  | Role        |',
      '  | ----- | ----------- |',
      '  | Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '- Roles',
        '  | Name | Role |',
        '  | --- | --- |',
        '  | Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given a list table indented with a tab, when normalizing, then keeps the table in the list', () => {
    const markdown = [
      '- Roles',
      '\t| Name  | Role        |',
      '\t| ----- | ----------- |',
      '\t| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '- Roles',
        '\t| Name | Role |',
        '\t| --- | --- |',
        '\t| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given a table under nested unordered list items, when normalizing, then keeps the table in the list', () => {
    const markdown = [
      '- Work',
      '  - Roles',
      '    | Name  | Role        |',
      '    | ----- | ----------- |',
      '    | Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '- Work',
        '  - Roles',
        '    | Name | Role |',
        '    | --- | --- |',
        '    | Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given a nested list table after a blank line, when normalizing, then keeps the table in the list', () => {
    const markdown = [
      '- Work',
      '  - Roles',
      '',
      '    | Name  | Role        |',
      '    | ----- | ----------- |',
      '    | Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '- Work',
        '  - Roles',
        '',
        '    | Name | Role |',
        '    | --- | --- |',
        '    | Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given a blockquoted nested list table after a blank line, when normalizing, then keeps the table in the list', () => {
    const markdown = [
      '> - Work',
      '>   - Roles',
      '>',
      '>     | Name  | Role        |',
      '>     | ----- | ----------- |',
      '>     | Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '> - Work',
        '>   - Roles',
        '>',
        '>     | Name | Role |',
        '>     | --- | --- |',
        '>     | Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given a list item code block with table-shaped text, when normalizing, then leaves the code unchanged', () => {
    const markdown = [
      '- Work',
      '',
      '      | Name  | Role        |',
      '      | ----- | ----------- |',
      '      | Davey | Builder     |',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '- Work',
        '',
        '      | Name  | Role        |',
        '      | ----- | ----------- |',
        '      | Davey | Builder     |',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given blockquoted list item code has table-shaped text, when normalizing, then leaves the code unchanged', () => {
    const markdown = [
      '> - Work',
      '>',
      '>       | Name  | Role        |',
      '>       | ----- | ----------- |',
      '>       | Davey | Builder     |',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '> - Work',
        '>',
        '>       | Name  | Role        |',
        '>       | ----- | ----------- |',
        '>       | Davey | Builder     |',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given a table under deeply nested mixed list items, when normalizing, then keeps the table in the list', () => {
    const markdown = [
      '- Work',
      '  1. Teams',
      '     - Roles',
      '       | Name  | Role        |',
      '       | ----- | ----------- |',
      '       | Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '- Work',
        '  1. Teams',
        '     - Roles',
        '       | Name | Role |',
        '       | --- | --- |',
        '       | Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given a table under nested ordered list items, when normalizing compact tables, then keeps the table in the list', () => {
    const markdown = [
      '1. Work',
      '   1. Roles',
      '      | Name  | Role        |',
      '      | ----- | ----------- |',
      '      | Davey | Builder     |',
    ].join('\n');

    expect(
      normalizeMarkdownTables(markdown, { markdownTableStyle: 'compact' }),
    ).toBe(
      [
        '1. Work',
        '   1. Roles',
        '      |Name|Role|',
        '      |---|---|',
        '      |Davey|Builder|',
      ].join('\n'),
    );
  });

  test('given a table inside a footnote, when normalizing, then keeps the table in the footnote', () => {
    const markdown = [
      'Footnote ref.[^roles]',
      '',
      '[^roles]: Roles',
      '',
      '    | Name  | Role        |',
      '    | ----- | ----------- |',
      '    | Davey | Builder     |',
      '',
      'After.',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
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
      ].join('\n'),
    );
  });

  test('given a table inside a blockquoted footnote, when normalizing, then keeps the table in the footnote', () => {
    const markdown = [
      '> Footnote ref.[^roles]',
      '>',
      '> [^roles]: Roles',
      '>',
      '>     | Name  | Role        |',
      '>     | ----- | ----------- |',
      '>     | Davey | Builder     |',
      '>',
      '> After.',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '> Footnote ref.[^roles]',
        '>',
        '> [^roles]: Roles',
        '>',
        '>     | Name | Role |',
        '>     | --- | --- |',
        '>     | Davey | Builder |',
        '>',
        '> After.',
      ].join('\n'),
    );
  });

  test('given table-shaped indented code inside a footnote, when normalizing, then leaves the code unchanged', () => {
    const markdown = [
      '[^roles]: Roles',
      '',
      '        | Name  | Role        |',
      '        | ----- | ----------- |',
      '        | Davey | Builder     |',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '[^roles]: Roles',
        '',
        '        | Name  | Role        |',
        '        | ----- | ----------- |',
        '        | Davey | Builder     |',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given blockquoted footnote code has table-shaped text, when normalizing, then leaves the code unchanged', () => {
    const markdown = [
      '> [^roles]: Roles',
      '>',
      '>         | Name  | Role        |',
      '>         | ----- | ----------- |',
      '>         | Davey | Builder     |',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '> [^roles]: Roles',
        '>',
        '>         | Name  | Role        |',
        '>         | ----- | ----------- |',
        '>         | Davey | Builder     |',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given large MDX without JSX starts, when normalizing with JSX protection, then it avoids joined scan text', () => {
    const markdown = `${Array.from({ length: 600 }, (_, index) =>
      [
        `Section ${String(index)}`,
        '',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        `| Davey ${String(index)} | Builder     |`,
        '',
      ].join('\n'),
    ).join('\n')}\n`;
    const joinedLargeLineArrays: Array<number> = [];
    const originalJoin: typeof Array.prototype.join = Array.prototype.join;

    Array.prototype.join = function trackLargeLineJoins(
      this: Array<unknown>,
      separator?: string,
    ): string {
      if (separator === '\n' && this.length > 500) {
        joinedLargeLineArrays.push(this.length);
      }

      return originalJoin.call(this, separator);
    };

    try {
      const start = IS_STRICT_PERFORMANCE_TEST ? performance.now() : undefined;
      const normalized = normalizeMarkdownTables(markdown, {
        enableMdxJsx: true,
      });

      expect(normalized).toContain('| Davey 599 | Builder |');
      expect(joinedLargeLineArrays).toEqual([]);

      if (start !== undefined) {
        expectStressDurationBelow(
          performance.now() - start,
          2_000,
          markdown.length,
          countMarkdownLines(markdown),
        );
      }
    } finally {
      Array.prototype.join = originalJoin;
    }
  });

  test('given large MDX has an early complete JSX element, when normalizing with JSX protection, then it avoids full joined scan text', () => {
    const protectedJsx = [
      '<Demo>',
      '  | Keep  | JSX  |',
      '  | ----- | ---- |',
      '  | this  | text |',
      '</Demo>',
      '',
    ].join('\n');
    const markdown = `${protectedJsx}${Array.from({ length: 600 }, (_, index) =>
      [
        `Section ${String(index)}`,
        '',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        `| Davey ${String(index)} | Builder     |`,
        '',
      ].join('\n'),
    ).join('\n')}\n`;
    const joinedLargeLineArrays: Array<number> = [];
    const originalJoin: typeof Array.prototype.join = Array.prototype.join;

    Array.prototype.join = function trackLargeLineJoins(
      this: Array<unknown>,
      separator?: string,
    ): string {
      if (separator === '\n' && this.length > 500) {
        joinedLargeLineArrays.push(this.length);
      }

      return originalJoin.call(this, separator);
    };

    try {
      const start = IS_STRICT_PERFORMANCE_TEST ? performance.now() : undefined;
      const normalized = normalizeMarkdownTables(markdown, {
        enableMdxJsx: true,
      });

      expect(normalized).toContain('| Keep  | JSX  |');
      expect(normalized).toContain('| Davey 599 | Builder |');
      expect(joinedLargeLineArrays).toEqual([]);

      if (start !== undefined) {
        expectStressDurationBelow(
          performance.now() - start,
          2_000,
          markdown.length,
          countMarkdownLines(markdown),
        );
      }
    } finally {
      Array.prototype.join = originalJoin;
    }
  });

  test('given an MDX HTML prettier-ignore before a Markdown table, when normalizing with MDX protection, then it leaves that table unchanged', () => {
    const markdown = [
      '<!-- prettier-ignore -->',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
      '| After  | Table      |',
      '| ------ | ---------- |',
      '| normal | collapses  |',
    ].join('\n');

    expect(
      normalizeMarkdownTables(markdown, {
        enableMdxEsm: true,
        enableMdxJsx: true,
      }),
    ).toBe(
      [
        '<!-- prettier-ignore -->',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '',
        '| After | Table |',
        '| --- | --- |',
        '| normal | collapses |',
      ].join('\n'),
    );
  });

  test('given an MDX JSX prettier-ignore before JSX table text, when normalizing with MDX JSX enabled, then it leaves JSX unchanged', () => {
    const markdown = [
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
    ].join('\n');

    expect(normalizeMarkdownTables(markdown, { enableMdxJsx: true })).toBe(
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
      ].join('\n'),
    );
  });

  test('given an MDX JSX prettier-ignore before a Markdown table, when normalizing with MDX protection, then it leaves that table unchanged', () => {
    const markdown = [
      '{/* prettier-ignore */}',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
      '| After  | Table      |',
      '| ------ | ---------- |',
      '| normal | collapses  |',
    ].join('\n');

    expect(
      normalizeMarkdownTables(markdown, {
        enableMdxEsm: true,
        enableMdxJsx: true,
      }),
    ).toBe(
      [
        '{/* prettier-ignore */}',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '',
        '| After | Table |',
        '| --- | --- |',
        '| normal | collapses |',
      ].join('\n'),
    );
  });

  test('given an MDX JSX prettier-ignore range surrounds tables, when normalizing with MDX protection, then it leaves the range unchanged', () => {
    const markdown = [
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
    ].join('\n');

    expect(
      normalizeMarkdownTables(markdown, {
        enableMdxEsm: true,
        enableMdxJsx: true,
      }),
    ).toBe(
      [
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
        '| After | Table |',
        '| --- | --- |',
        '| normal | collapses |',
      ].join('\n'),
    );
  });

  test('given nested MDX JSX with table-shaped children, when normalizing with MDX JSX enabled, then leaves the JSX unchanged', () => {
    const markdown = [
      '<Demo.Root>',
      '  <Demo.Panel>',
      '    | Name  | Role        |',
      '    | ----- | ----------- |',
      '    | Davey | Builder     |',
      '  </Demo.Panel>',
      '</Demo.Root>',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown, { enableMdxJsx: true })).toBe(
      [
        '<Demo.Root>',
        '  <Demo.Panel>',
        '    | Name  | Role        |',
        '    | ----- | ----------- |',
        '    | Davey | Builder     |',
        '  </Demo.Panel>',
        '</Demo.Root>',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given misnested MDX JSX is followed by a Markdown table, when normalizing with MDX JSX enabled, then it rejects the JSX region', () => {
    const markdown = [
      '<Outer>',
      '<Inner>',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '</Outer>',
      '',
      '| Tool  | Use         |',
      '| ----- | ----------- |',
      '| Codex | Pair worker |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown, { enableMdxJsx: true })).toBe(
      [
        '<Outer>',
        '<Inner>',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '</Outer>',
        '',
        '| Tool | Use |',
        '| --- | --- |',
        '| Codex | Pair worker |',
      ].join('\n'),
    );
  });

  test('given MDX JSX with multiline props and blank children, when normalizing with MDX JSX enabled, then leaves the JSX unchanged', () => {
    const markdown = [
      '<Example',
      '  label="literal /> text"',
      '  data={{',
      '    closing: "/>",',
      '  }}',
      '>',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
      '</Example>',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown, { enableMdxJsx: true })).toBe(
      [
        '<Example',
        '  label="literal /> text"',
        '  data={{',
        '    closing: "/>",',
        '  }}',
        '>',
        '',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '',
        '</Example>',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given MDX JSX child expressions contain closing-tag text, when normalizing with MDX JSX enabled, then leaves later JSX table text unchanged', () => {
    const markdown = [
      '<Demo>',
      '  {() => "</Demo>"}',
      '  {/** </Demo> */}',
      '  {',
      '    /<\\/Demo>/.test(value) ? `</Demo>` : null',
      '  }',
      '  | Name  | Role        |',
      '  | ----- | ----------- |',
      '  | Davey | Builder     |',
      '</Demo>',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown, { enableMdxJsx: true })).toBe(
      [
        '<Demo>',
        '  {() => "</Demo>"}',
        '  {/** </Demo> */}',
        '  {',
        '    /<\\/Demo>/.test(value) ? `</Demo>` : null',
        '  }',
        '  | Name  | Role        |',
        '  | ----- | ----------- |',
        '  | Davey | Builder     |',
        '</Demo>',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given namespaced and web component MDX JSX, when normalizing with MDX JSX enabled, then leaves the JSX unchanged', () => {
    const markdown = [
      '<docs:Panel>',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '</docs:Panel>',
      '',
      '<my-widget>',
      '| Tool  | Use         |',
      '| ----- | ----------- |',
      '| Codex | Pair worker |',
      '</my-widget>',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown, { enableMdxJsx: true })).toBe(
      [
        '<docs:Panel>',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '</docs:Panel>',
        '',
        '<my-widget>',
        '| Tool  | Use         |',
        '| ----- | ----------- |',
        '| Codex | Pair worker |',
        '</my-widget>',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given MDX JSX names start with dollar, underscore, or Unicode, when normalizing with MDX JSX enabled, then leaves JSX children unchanged', () => {
    const markdown = [
      '<$Chart>',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '</$Chart>',
      '',
      '<_Panel.Body>',
      '| Tool  | Use         |',
      '| ----- | ----------- |',
      '| Codex | Pair worker |',
      '</_Panel.Body>',
      '',
      '<ΩChart.Header>',
      '| Area  | Status      |',
      '| ----- | ----------- |',
      '| MDX   | Protected   |',
      '</ΩChart.Header>',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown, { enableMdxJsx: true })).toBe(
      [
        '<$Chart>',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '</$Chart>',
        '',
        '<_Panel.Body>',
        '| Tool  | Use         |',
        '| ----- | ----------- |',
        '| Codex | Pair worker |',
        '</_Panel.Body>',
        '',
        '<ΩChart.Header>',
        '| Area  | Status      |',
        '| ----- | ----------- |',
        '| MDX   | Protected   |',
        '</ΩChart.Header>',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given MDX JSX lowercase elements and fragments, when normalizing with MDX JSX enabled, then leaves JSX children unchanged', () => {
    const markdown = [
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
      '<section>',
      '| Area  | Status      |',
      '| ----- | ----------- |',
      '| MDX   | Protected   |',
      '</section>',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown, { enableMdxJsx: true })).toBe(
      [
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
        '<section>',
        '| Area  | Status      |',
        '| ----- | ----------- |',
        '| MDX   | Protected   |',
        '</section>',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given unclosed MDX JSX is followed by a later table, when normalizing with MDX JSX enabled, then it does not protect through EOF', () => {
    const markdown = [
      '<Demo>',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
      '| Tool  | Use         |',
      '| ----- | ----------- |',
      '| Codex | Pair worker |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown, { enableMdxJsx: true })).toBe(
      [
        '<Demo>',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '',
        '| Tool | Use |',
        '| --- | --- |',
        '| Codex | Pair worker |',
      ].join('\n'),
    );
  });

  test('given Markdown has a custom JSX-like tag before a table, when normalizing, then the table still collapses', () => {
    const markdown = [
      '<CustomThing>',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '<CustomThing>',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given Markdown has an unclosed JSX-like tag and MDX JSX scanning is enabled, when normalizing, then a later table still collapses', () => {
    const markdown = [
      '<CustomThing>',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown, { enableMdxJsx: true })).toBe(
      [
        '<CustomThing>',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given Markdown has invalid JSX-like prose, when normalizing without MDX JSX scanning, then a later table still collapses', () => {
    const markdown = [
      '<*Chart>',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '<*Chart>',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given a table in a blockquote, when normalizing, then keeps every row quoted', () => {
    const markdown = [
      '> | Name  | Role        |',
      '> | ----- | ----------- |',
      '> | Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      ['> | Name | Role |', '> | --- | --- |', '> | Davey | Builder |'].join(
        '\n',
      ),
    );
  });

  test('given blockquote-indented code with table-shaped text, when normalizing, then leaves the code unchanged', () => {
    const markdown = [
      '>     | Name  | Role        |',
      '>     | ----- | ----------- |',
      '>     | Davey | Builder     |',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '>     | Name  | Role        |',
        '>     | ----- | ----------- |',
        '>     | Davey | Builder     |',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given a blockquote table with equivalent prefix spacing, when normalizing twice, then it stays normalized', () => {
    const markdown = [
      '> | Name  | Role        |',
      '>  | ----- | ----------- |',
      '>   | Davey | Builder     |',
    ].join('\n');
    const normalized = [
      '> | Name | Role |',
      '> | --- | --- |',
      '> | Davey | Builder |',
    ].join('\n');

    const once = normalizeMarkdownTables(markdown);

    expect(once).toBe(normalized);
    expect(normalizeMarkdownTables(once)).toBe(normalized);
  });

  test('given a list table with equivalent continuation spacing, when normalizing twice, then it stays normalized', () => {
    const markdown = [
      '- Roles',
      '  | Name  | Role        |',
      '   | ----- | ----------- |',
      '  | Davey | Builder     |',
    ].join('\n');
    const normalized = [
      '- Roles',
      '  | Name | Role |',
      '  | --- | --- |',
      '  | Davey | Builder |',
    ].join('\n');

    const once = normalizeMarkdownTables(markdown);

    expect(once).toBe(normalized);
    expect(normalizeMarkdownTables(once)).toBe(normalized);
  });

  test('given a table in a quoted list, when normalizing, then keeps the nested prefix', () => {
    const markdown = [
      '> - Roles',
      '>   | Name  | Role        |',
      '>   | ----- | ----------- |',
      '>   | Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '> - Roles',
        '>   | Name | Role |',
        '>   | --- | --- |',
        '>   | Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given a root table followed by a quoted table, when normalizing, then normalizes both tables', () => {
    const markdown = [
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '> | Tool  | Use         |',
      '> | ----- | ----------- |',
      '> | Codex | Pair worker |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
        '> | Tool | Use |',
        '> | --- | --- |',
        '> | Codex | Pair worker |',
      ].join('\n'),
    );
  });

  test('given a list table followed by a root table, when normalizing, then normalizes both tables', () => {
    const markdown = [
      '- Roles',
      '  | Name  | Role        |',
      '  | ----- | ----------- |',
      '  | Davey | Builder     |',
      '| Tool  | Use         |',
      '| ----- | ----------- |',
      '| Codex | Pair worker |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '- Roles',
        '  | Name | Role |',
        '  | --- | --- |',
        '  | Davey | Builder |',
        '| Tool | Use |',
        '| --- | --- |',
        '| Codex | Pair worker |',
      ].join('\n'),
    );
  });

  test('given table rows with inconsistent prefixes, when normalizing, then leaves the rows unchanged', () => {
    const markdown = [
      '> | Name  | Role        |',
      '| ----- | ----------- |',
      '> | Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  test('given a one-cell header and two-cell delimiter, when normalizing, then leaves the rows unchanged', () => {
    const markdown = ['| Name  |', '| ----- | ----- |', '| Davey |'].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  test('given a two-cell header and one-cell delimiter, when normalizing, then leaves the rows unchanged', () => {
    const markdown = [
      '| Name  | Role        |',
      '| ----- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  test('given an empty delimiter cell, when normalizing, then leaves the rows unchanged', () => {
    const markdown = [
      '| Name  | Role        |',
      '| ----- |             |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  test('given a malformed delimiter cell, when normalizing, then leaves the rows unchanged', () => {
    const markdown = [
      '| Name  | Role        |',
      '| --    | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  test('given a table after prettier-ignore, when normalizing, then leaves that table unchanged', () => {
    const markdown = [
      '<!-- prettier-ignore -->',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '<!-- prettier-ignore -->',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given prettier-ignore overlaps HTML comment syntax, when normalizing, then ignore detection protects the next table', () => {
    const markdown = [
      '<!-- prettier-ignore -->',
      '| Keep  | Ignored |',
      '| ----- | ------- |',
      '| this  | table   |',
      '',
      '<!--',
      '| Keep  | Comment |',
      '| ----- | ------- |',
      '| this  | text    |',
      '-->',
      '',
      '| After  | Table       |',
      '| ------ | ----------- |',
      '| yes    | 1           |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '<!-- prettier-ignore -->',
        '| Keep  | Ignored |',
        '| ----- | ------- |',
        '| this  | table   |',
        '',
        '<!--',
        '| Keep  | Comment |',
        '| ----- | ------- |',
        '| this  | text    |',
        '-->',
        '',
        '| After | Table |',
        '| --- | --- |',
        '| yes | 1 |',
      ].join('\n'),
    );
  });

  test('given prettier-ignore before a list item table, when normalizing, then leaves that table unchanged', () => {
    const markdown = [
      '<!-- prettier-ignore -->',
      '- Item',
      '  | Name  | Role        |',
      '  | ----- | ----------- |',
      '  | Davey | Builder     |',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '<!-- prettier-ignore -->',
        '- Item',
        '  | Name  | Role        |',
        '  | ----- | ----------- |',
        '  | Davey | Builder     |',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given prettier-ignore before a blockquote table, when normalizing, then leaves that table unchanged', () => {
    const markdown = [
      '<!-- prettier-ignore -->',
      '> Quote',
      '>',
      '> | Name  | Role        |',
      '> | ----- | ----------- |',
      '> | Davey | Builder     |',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '<!-- prettier-ignore -->',
        '> Quote',
        '>',
        '> | Name  | Role        |',
        '> | ----- | ----------- |',
        '> | Davey | Builder     |',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given tables inside a prettier-ignore range, when normalizing, then leaves the range unchanged', () => {
    const markdown = [
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
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
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
      ].join('\n'),
    );
  });

  test('given prettier-ignore-start inside fenced code, when normalizing, then it does not affect a later table', () => {
    const markdown = [
      '```md',
      '<!-- prettier-ignore-start -->',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '```',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '```md',
        '<!-- prettier-ignore-start -->',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '```',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given prettier-ignore inside an HTML comment, when normalizing, then it does not affect a later table', () => {
    const markdown = [
      '<!--',
      '<!-- prettier-ignore -->',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '-->',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '<!--',
        '<!-- prettier-ignore -->',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '-->',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });

  test('given prettier-ignore-start inside raw HTML, when normalizing, then it does not affect a later table', () => {
    const markdown = [
      '<script>',
      '<!-- prettier-ignore-start -->',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '</script>',
      '',
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(
      [
        '<script>',
        '<!-- prettier-ignore-start -->',
        '| Name  | Role        |',
        '| ----- | ----------- |',
        '| Davey | Builder     |',
        '</script>',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Davey | Builder |',
      ].join('\n'),
    );
  });
});
