import { describe, expect, test } from 'vitest';

import { toLineIndex } from '../src/normalizer/lineUtils.js';
import {
  findMarkdownTableBlock,
  mayContainMarkdownTableCandidate,
  parseMarkdownTableRowInternal as parseMarkdownTableRow,
} from '../src/normalizer/tableRows.js';

describe('tableRows', () => {
  test('given a row with a list and blockquote prefix, when parsing, then it reports prefix and cells', () => {
    expect(parseMarkdownTableRow('>   | Name  | Role |')).toEqual({
      balanced: true,
      cells: [' Name  ', ' Role '],
      content: '| Name  | Role |',
      delimiterPositions: [8],
      fragments: [' Name  ', ' Role '],
      hasTrailingPipe: true,
      prefix: '>   ',
      rawDelimiterPositions: [8],
    });
  });

  test('given a row with code and escaped pipes, when parsing, then trusted cells differ from repair fragments', () => {
    expect(
      parseMarkdownTableRow('| `foo | bar` | foo\\          |          bar |'),
    ).toEqual({
      balanced: true,
      cells: [' `foo | bar` ', ' foo\\          ', '          bar '],
      content: '| `foo | bar` | foo\\          |          bar |',
      delimiterPositions: [14, 30],
      fragments: [' `foo ', ' bar` ', ' foo\\          ', '          bar '],
      hasTrailingPipe: true,
      prefix: '',
      rawDelimiterPositions: [7, 14, 30],
    });
  });

  test('given a row without a trailing pipe and an unclosed code span, when parsing, then it reports low-confidence metadata', () => {
    expect(parseMarkdownTableRow('| `foo | bar')).toEqual({
      balanced: false,
      cells: [' `foo ', ' bar'],
      content: '| `foo | bar',
      delimiterPositions: [7],
      fragments: [' `foo ', ' bar'],
      hasTrailingPipe: false,
      prefix: '',
      rawDelimiterPositions: [7],
    });
  });

  test('given a table has a BOM header and later non-table text, when finding the block, then it returns parsed table rows only', () => {
    const lines = [
      '\uFEFF| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      'not a table',
    ];

    const block = findMarkdownTableBlock(lines, toLineIndex(0));

    expect(block?.start).toBe(0);
    expect(block?.end).toBe(2);
    expect(block?.lines).toEqual([
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ]);
    expect(block?.rows.map((row) => row.cells)).toEqual([
      [' Name  ', ' Role        '],
      [' ----- ', ' ----------- '],
      [' Davey ', ' Builder     '],
    ]);
  });

  test('given a table is capped by a protected row, when finding the block, then it stops before that row', () => {
    const lines = [
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
      '| Keep  | Protected   |',
    ];

    const block = findMarkdownTableBlock(lines, toLineIndex(0), {
      protectedLines: [false, false, false, true],
    });

    expect(block?.end).toBe(2);
    expect(block?.lines).toEqual([
      '| Name  | Role        |',
      '| ----- | ----------- |',
      '| Davey | Builder     |',
    ]);
  });

  test('given prose pipes and real table delimiters, when checking table candidates, then only table-shaped line pairs match', () => {
    expect(
      mayContainMarkdownTableCandidate(
        ['A sentence with | a pipe.', 'Another | prose pipe.'].join('\n'),
      ),
    ).toBe(false);

    expect(
      mayContainMarkdownTableCandidate(
        ['Name | Role', '--- | ---', 'Davey | Builder'].join('\n'),
      ),
    ).toBe(true);

    expect(
      mayContainMarkdownTableCandidate(
        ['> | Name | Role |', '> | --- | --- |', '> | Davey | Builder |'].join(
          '\n',
        ),
      ),
    ).toBe(true);
  });
});
