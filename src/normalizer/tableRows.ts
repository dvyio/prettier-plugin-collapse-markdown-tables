/**
 * @fileoverview Parses Markdown table rows and checks table row safety.
 */

import type { ParsedMarkdownTableRow } from './publicTypes.js';
import type {
  CellScanResult,
  CodeSpanDelimiterRun,
  CodeSpanRange,
  CodeSpanScanResult,
  ColumnCount,
  LineIndex,
  LineRange,
  MarkdownOffset,
  MarkdownTableBlock,
  NormalizationRange,
  ParsedTableRow,
  TableRowPrefix,
  TableRowPrefixShape,
} from './types.js';

import { assertNever } from './assertNever.js';
import {
  countRun,
  isMarkdownEscapedCharacter,
  stripRootByteOrderMark,
  tableBlockIntersectsRange,
  toColumnCount,
  toLineIndex,
  toMarkdownOffset,
} from './lineUtils.js';
import { repairBrokenCells } from './tableRepair.js';

function parseTableRowPrefix(value: string): TableRowPrefix | undefined {
  if (!/^[ \t]*(?:>[ \t]*)*$/.test(value)) {
    return undefined;
  }

  return value as TableRowPrefix;
}

/**
 * Parses one pipe-started table row into cells and repair metadata.
 *
 * The parser accepts rows with compatible Markdown prefixes even when the row
 * is malformed. Callers can use `hasTrailingPipe`, `balanced`, and the raw
 * fragments to decide whether a row is safe to normalize or repair.
 *
 * @param line - one Markdown line that may contain a pipe-wrapped table row.
 * @returns Parsed row details, or `undefined` when the text has no valid table prefix.
 */
export function parseMarkdownTableRowInternal(
  line: string,
): ParsedMarkdownTableRow | undefined {
  return parseTableRow(line);
}

function parseTableRow(line: string): ParsedTableRow | undefined {
  const pipeIndex = line.indexOf('|');

  if (pipeIndex === -1) {
    return undefined;
  }

  const prefix = parseTableRowPrefix(line.slice(0, pipeIndex));

  if (prefix === undefined) {
    return undefined;
  }

  const content = line.slice(pipeIndex);
  const codeSpans = scanCodeSpans(content);
  const lastNonWhitespaceIndex = findLastNonWhitespaceIndex(content);
  const cells = scanTableCells(
    content,
    codeSpans,
    lastNonWhitespaceIndex,
    'trusted',
  );
  const fragments = scanTableCells(
    content,
    codeSpans,
    lastNonWhitespaceIndex,
    'raw',
  );

  return {
    balanced: !codeSpans.hasUnclosedCodeSpan,
    cells: cells.cells,
    content,
    delimiterPositions: cells.delimiterPositions,
    fragments: fragments.cells,
    hasTrailingPipe: content[lastNonWhitespaceIndex] === '|',
    prefix,
    rawDelimiterPositions: fragments.delimiterPositions,
  };
}

function findLastNonWhitespaceIndex(value: string): number {
  for (let index = value.length - 1; index >= 0; index--) {
    const char = value[index];

    if (char !== undefined && !isMarkdownLineWhitespace(char)) {
      return index;
    }
  }

  return -1;
}

function isMarkdownLineWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\r';
}

/** Parses a row only when it starts and ends with a pipe. */
export function parsePipedRow(line: string): ParsedTableRow | undefined {
  const row = parseTableRow(line);

  if (
    row === undefined ||
    !row.content.startsWith('|') ||
    !row.hasTrailingPipe
  ) {
    return undefined;
  }

  return row;
}

type FindMarkdownTableBlockOptions = {
  readonly end?: LineIndex;
  readonly protectedLines?: ReadonlyArray<boolean>;
};

/**
 * Finds one safe Markdown table block and returns the parsed rows with its line range.
 */
export function findMarkdownTableBlock(
  lines: ReadonlyArray<string>,
  start: LineIndex,
  options: FindMarkdownTableBlockOptions = {},
): MarkdownTableBlock | undefined {
  if (lines.length === 0) {
    return undefined;
  }

  const searchEnd = options.end ?? toLineIndex(lines.length - 1);

  if (
    start >= lines.length ||
    start + 1 > searchEnd ||
    options.protectedLines?.[start] === true ||
    options.protectedLines?.[start + 1] === true
  ) {
    return undefined;
  }

  const headerLine = stripRootByteOrderMark(lines[start] ?? '', start);
  const separatorLine = lines[start + 1];

  if (headerLine === '' || separatorLine === undefined) {
    return undefined;
  }

  const header = parsePipedRow(headerLine);
  const separator = parsePipedRow(separatorLine);

  if (
    header === undefined ||
    separator === undefined ||
    !hasValidDelimiterRow(header, separator)
  ) {
    return undefined;
  }

  const blockLines = [headerLine, separatorLine];
  const rows = [header, separator];
  let end: number = start + 1;

  for (let index = start + 2; index <= searchEnd; index++) {
    if (options.protectedLines?.[index] === true) {
      break;
    }

    const line = lines[index];

    if (line === undefined) {
      break;
    }

    const row = parsePipedRow(line);

    if (
      row === undefined ||
      !hasCompatibleTableRowPrefix(header.prefix, row.prefix)
    ) {
      break;
    }

    blockLines.push(line);
    rows.push(row);
    end = index;
  }

  return {
    end: toLineIndex(end),
    lines: blockLines,
    rows,
    start,
  };
}

/** Returns true when Markdown contains a table-like line pair inside the requested range. */
export function mayContainMarkdownTableCandidate(
  markdown: string,
  range?: NormalizationRange,
): boolean {
  if (!markdown.includes('|')) {
    return false;
  }

  let previousLine: string | undefined;
  let previousLineStart = 0;
  let lineStart = 0;
  let index = 0;

  while (index <= markdown.length) {
    const lineEnd = findMarkdownLineEnd(markdown, index);
    const line = markdown.slice(lineStart, lineEnd);

    if (
      previousLine !== undefined &&
      previousLine.includes('|') &&
      isPotentialMarkdownDelimiterLine(line) &&
      textRangeIntersectsNormalizationRange(previousLineStart, lineEnd, range)
    ) {
      return true;
    }

    if (lineEnd >= markdown.length) {
      break;
    }

    previousLine = line;
    previousLineStart = lineStart;
    index = skipMarkdownLineSeparator(markdown, lineEnd);
    lineStart = index;
  }

  return false;
}

/** Extends a line window so partial ranges still scan adjacent pipe-wrapped rows. */
export function expandLineWindowToAdjacentPipedRows(
  lines: ReadonlyArray<string>,
  window: LineRange,
): LineRange {
  let start: number = window.start;
  let end: number = window.end;

  while (start > 0 && isPipedRowAtLine(lines, start - 1)) {
    start--;
  }

  while (end + 1 < lines.length && isPipedRowAtLine(lines, end + 1)) {
    end++;
  }

  return {
    end: toLineIndex(end),
    start: toLineIndex(start),
  };
}

/** Checks whether a line window contains a safe table that overlaps the requested range. */
export function lineWindowContainsTableInRange(
  lines: ReadonlyArray<string>,
  lineStartOffsets: ReadonlyArray<MarkdownOffset>,
  markdownLength: MarkdownOffset,
  range: NormalizationRange | undefined,
  window: LineRange,
): boolean {
  for (let index = window.start; index <= window.end; index++) {
    const tableBlock = findMarkdownTableBlock(lines, toLineIndex(index), {
      end: window.end,
    });

    if (tableBlock === undefined) {
      continue;
    }

    if (
      tableBlockIntersectsRange(
        tableBlock.start,
        tableBlock.lines.length,
        lines,
        lineStartOffsets,
        markdownLength,
        range,
      )
    ) {
      return true;
    }

    index = tableBlock.end;
  }

  return false;
}

/**
 * Finds closed code spans and reports unclosed spans so table pipes inside trusted spans stay as cell text.
 */
export function scanCodeSpans(value: string): CodeSpanScanResult {
  const runs = collectCodeSpanDelimiterRuns(value);
  const spans: Array<CodeSpanRange> = [];
  const runIndexesByLength = getCodeSpanRunIndexesByLength(runs);
  const runCursorsByLength = new Map<number, number>();
  let hasUnclosedCodeSpan = false;

  for (let runIndex = 0; runIndex < runs.length; ) {
    const run = runs[runIndex];

    if (run === undefined) {
      break;
    }

    if (run.isEscaped) {
      runIndex++;
      continue;
    }

    const closingRunIndex = findNextCodeSpanRunIndex(
      run.length,
      runIndex,
      runIndexesByLength,
      runCursorsByLength,
    );

    if (closingRunIndex === undefined) {
      hasUnclosedCodeSpan = true;
      runIndex++;
      continue;
    }

    const closingRun = runs[closingRunIndex];

    if (closingRun === undefined) {
      hasUnclosedCodeSpan = true;
      runIndex++;
      continue;
    }

    spans.push({ end: closingRun.end, start: run.start });
    runIndex = closingRunIndex + 1;
  }

  return { hasUnclosedCodeSpan, spans };
}

function collectCodeSpanDelimiterRuns(
  value: string,
): ReadonlyArray<CodeSpanDelimiterRun> {
  const runs: Array<CodeSpanDelimiterRun> = [];

  for (let index = 0; index < value.length; ) {
    if (value[index] !== '`') {
      index++;
      continue;
    }

    const length = countRun(value, index, '`');
    const end = index + length;

    runs.push({
      end: toMarkdownOffset(end),
      isEscaped: isMarkdownEscapedCharacter(value, index),
      length,
      start: toMarkdownOffset(index),
    });

    index = end;
  }

  return runs;
}

function getCodeSpanRunIndexesByLength(
  runs: ReadonlyArray<CodeSpanDelimiterRun>,
): ReadonlyMap<number, ReadonlyArray<number>> {
  const indexesByLength = new Map<number, Array<number>>();

  for (let index = 0; index < runs.length; index++) {
    const run = runs[index];

    if (run === undefined) {
      continue;
    }

    const indexes = indexesByLength.get(run.length);

    if (indexes === undefined) {
      indexesByLength.set(run.length, [index]);
      continue;
    }

    indexes.push(index);
  }

  return indexesByLength;
}

function findNextCodeSpanRunIndex(
  delimiterLength: number,
  currentRunIndex: number,
  runIndexesByLength: ReadonlyMap<number, ReadonlyArray<number>>,
  runCursorsByLength: Map<number, number>,
): number | undefined {
  const runIndexes = runIndexesByLength.get(delimiterLength);

  if (runIndexes === undefined) {
    return undefined;
  }

  let cursor = runCursorsByLength.get(delimiterLength) ?? 0;

  while (
    cursor < runIndexes.length &&
    (runIndexes[cursor] ?? Number.NEGATIVE_INFINITY) <= currentRunIndex
  ) {
    cursor++;
  }

  runCursorsByLength.set(delimiterLength, cursor);

  return runIndexes[cursor];
}

/** Checks whether two table row prefixes belong to the same Markdown container shape. */
export function hasCompatibleTableRowPrefix(
  first: TableRowPrefix,
  second: TableRowPrefix,
): boolean {
  const firstShape = parseTableRowPrefixShape(first);
  const secondShape = parseTableRowPrefixShape(second);

  if (firstShape.type !== secondShape.type) {
    return false;
  }

  switch (firstShape.type) {
    case 'blockquote':
      if (secondShape.type !== 'blockquote') {
        return false;
      }

      return firstShape.markers === secondShape.markers;

    case 'indented':
    case 'root':
      return true;

    default:
      return assertNever(firstShape);
  }
}

function parseTableRowPrefixShape(prefix: TableRowPrefix): TableRowPrefixShape {
  if (prefix.length === 0) {
    return { type: 'root' };
  }

  const markers = [...prefix].filter((char) => char === '>').join('');

  if (markers.length > 0) {
    return { markers, type: 'blockquote' };
  }

  return { type: 'indented' };
}

function scanTableCells(
  content: string,
  codeSpans: CodeSpanScanResult,
  lastNonWhitespaceIndex: number,
  mode: 'raw' | 'trusted',
): CellScanResult {
  const cells: Array<string> = [];
  const delimiterPositions: Array<MarkdownOffset> = [];
  let codeSpanIndex = 0;
  let index = 0;

  while (index < content.length && content[index] !== '|') {
    index++;
  }

  index++;
  let cellStart = index;

  while (index < content.length) {
    const char = content[index];

    if (char === undefined) {
      break;
    }

    while (codeSpanIndex < codeSpans.spans.length) {
      const nextCodeSpan = codeSpans.spans[codeSpanIndex];

      if (nextCodeSpan === undefined || nextCodeSpan.end > index) {
        break;
      }

      codeSpanIndex++;
    }

    const codeSpan = codeSpans.spans[codeSpanIndex];
    const isInCodeSpan =
      mode === 'trusted' &&
      codeSpan !== undefined &&
      index >= codeSpan.start &&
      index < codeSpan.end;

    if (
      char === '|' &&
      !isInCodeSpan &&
      !isMarkdownEscapedCharacter(content, index)
    ) {
      if (index >= lastNonWhitespaceIndex) {
        break;
      }

      delimiterPositions.push(toMarkdownOffset(index));
      cells.push(content.slice(cellStart, index));
      index++;
      cellStart = index;
      continue;
    }

    index++;
  }

  cells.push(content.slice(cellStart, index));

  return {
    cells,
    delimiterPositions,
  };
}

function isPipedRowAtLine(
  lines: ReadonlyArray<string>,
  index: number,
): boolean {
  return looksLikePipedRow(stripRootByteOrderMark(lines[index] ?? '', index));
}

/** Returns true when a line is a pipe-started table row with a trailing pipe. */
export function looksLikePipedRow(line: string): boolean {
  return parsePipedRow(line) !== undefined;
}

function findMarkdownLineEnd(markdown: string, start: number): number {
  let index = start;

  while (index < markdown.length) {
    const char = markdown[index];

    if (char === '\n' || char === '\r') {
      break;
    }

    index++;
  }

  return index;
}

function skipMarkdownLineSeparator(markdown: string, lineEnd: number): number {
  if (markdown[lineEnd] === '\r' && markdown[lineEnd + 1] === '\n') {
    return lineEnd + 2;
  }

  return lineEnd + 1;
}

function isPotentialMarkdownDelimiterLine(line: string): boolean {
  const text = line
    .replace(/^\uFEFF/, '')
    .replace(/^[ \t]*(?:>[ \t]*)*/, '')
    .trim();

  if (!text.includes('|')) {
    return false;
  }

  const cells = getPotentialDelimiterCells(text);

  return cells.length > 0 && cells.every(isValidDelimiterCell);
}

function getPotentialDelimiterCells(text: string): ReadonlyArray<string> {
  const cells = text.split('|').map((cell) => cell.trim());

  if (cells[0] === '') {
    cells.shift();
  }

  if (cells[cells.length - 1] === '') {
    cells.pop();
  }

  return cells;
}

function textRangeIntersectsNormalizationRange(
  start: number,
  end: number,
  range: NormalizationRange | undefined,
): boolean {
  if (range === undefined) {
    return true;
  }

  if (range.start === range.end) {
    return range.start >= start && range.start <= end;
  }

  return start < range.end && end > range.start;
}

function isValidDelimiterCell(cell: string): boolean {
  if (!/^:?-+:?$/.test(cell)) {
    return false;
  }

  const hyphenCount = cell.replaceAll(':', '').length;
  const hasAlignmentMarker = cell.includes(':');

  return hyphenCount >= 3 || (hasAlignmentMarker && cell.length >= 3);
}

/** Returns the column count only when every cell is a valid table delimiter. */
export function getValidDelimiterColumnCount(
  cells: ReadonlyArray<string>,
): ColumnCount | undefined {
  const delimiterCells = cells.map((cell) => cell.trim());

  if (
    delimiterCells.length === 0 ||
    !delimiterCells.every(isValidDelimiterCell)
  ) {
    return undefined;
  }

  return toColumnCount(delimiterCells.length);
}

function hasValidDelimiterRow(
  header: ParsedTableRow,
  delimiter: ParsedTableRow,
): boolean {
  return getValidTableColumnCount(header, delimiter) !== undefined;
}

/**
 * Returns the delimiter column count only when the header and delimiter can form a safe table start.
 */
export function getValidTableColumnCount(
  header: ParsedTableRow,
  delimiter: ParsedTableRow,
): ColumnCount | undefined {
  if (!header.balanced || !delimiter.balanced) {
    return undefined;
  }

  if (!hasCompatibleTableRowPrefix(header.prefix, delimiter.prefix)) {
    return undefined;
  }

  const expectedColumns = getValidDelimiterColumnCount(delimiter.fragments);

  if (expectedColumns === undefined) {
    return undefined;
  }

  if (header.cells.length === expectedColumns) {
    return expectedColumns;
  }

  if (header.fragments.length <= expectedColumns) {
    return undefined;
  }

  const repair = repairBrokenCells(header, expectedColumns);

  if (repair.status === 'failed') {
    return undefined;
  }

  return expectedColumns;
}
