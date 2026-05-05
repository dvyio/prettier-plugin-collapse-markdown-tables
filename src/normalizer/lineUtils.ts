/**
 * @fileoverview Splits Markdown lines and shares offset, range, and text-scan helpers.
 */

import type {
  ColumnCount,
  ContainerKey,
  LineIndex,
  LineRange,
  LineSeparator,
  MarkdownColumn,
  MarkdownIndent,
  MarkdownLines,
  MarkdownOffset,
  NormalizationRange,
  NormalizedOffset,
  ScanTextOffset,
  UncheckedNormalizeMarkdownTablesOptions,
} from './types.js';

import { describeUnknownValue } from './options.js';

const UTF8_BYTE_ORDER_MARK = '\uFEFF';
const MARKDOWN_TAB_WIDTH = 4;
const CONTAINER_KEY_PATTERN =
  /^(?:|(?:blockquote|indent|list)(?:\/(?:blockquote|indent|list))*)$/;

/** Markdown container key used when a line is not inside blockquote, list, or indented code. */
export const ROOT_CONTAINER_KEY = toContainerKey('');

/**
 * Checks and brands a Markdown container key.
 *
 * @param value - joined container parts such as `blockquote/list`.
 * @returns the same key after it matches the allowed container shape.
 * @throws Error when the key contains anything except known container parts.
 */
export function toContainerKey(value: string): ContainerKey {
  if (!CONTAINER_KEY_PATTERN.test(value)) {
    throw new Error(
      `Invalid container key "${value}" — expected Markdown container parts joined by "/".`,
    );
  }

  return value as ContainerKey;
}

/**
 * Splits Markdown into lines while keeping each original line separator for lossless joining.
 *
 * @param markdown - Markdown text to split.
 * @returns line text and the separator that followed each line.
 */
export function splitMarkdownLines(markdown: string): MarkdownLines {
  const lines: Array<string> = [];
  const lineSeparators: Array<'' | LineSeparator> = [];
  let lineStart = 0;
  let index = 0;

  while (index < markdown.length) {
    const char = markdown[index];
    const nextChar = markdown[index + 1];

    if (char === '\r' && nextChar === '\n') {
      lines.push(markdown.slice(lineStart, index));
      lineSeparators.push('\r\n');
      index += 2;
      lineStart = index;
      continue;
    }

    if (char === '\n') {
      lines.push(markdown.slice(lineStart, index));
      lineSeparators.push('\n');
      index++;
      lineStart = index;
      continue;
    }

    if (char === '\r') {
      lines.push(markdown.slice(lineStart, index));
      lineSeparators.push('\r');
      index++;
      lineStart = index;
      continue;
    }

    index++;
  }

  lines.push(markdown.slice(lineStart));
  lineSeparators.push('');

  return { lines, lineSeparators };
}

/**
 * Removes a byte order mark only when it appears on the first root line.
 *
 * @param line - line text to inspect.
 * @param index - zero-based line index in the Markdown document.
 * @returns the line without the root byte order mark, or the original line.
 */
export function stripRootByteOrderMark(line: string, index: number): string {
  if (index !== 0 || !line.startsWith(UTF8_BYTE_ORDER_MARK)) {
    return line;
  }

  return line.slice(UTF8_BYTE_ORDER_MARK.length);
}

/**
 * Restores a root byte order mark after table rows have been rebuilt.
 *
 * @param lines - normalized table block lines.
 * @param originalHeaderLine - table header line before normalization.
 * @param index - zero-based line index for the table header.
 * @returns normalized lines with the root byte order mark restored when needed.
 */
export function addRootByteOrderMark(
  lines: ReadonlyArray<string>,
  originalHeaderLine: string,
  index: number,
): ReadonlyArray<string> {
  if (index !== 0 || !originalHeaderLine.startsWith(UTF8_BYTE_ORDER_MARK)) {
    return lines;
  }

  const first = lines[0];

  if (first === undefined) {
    return lines;
  }

  return [`${UTF8_BYTE_ORDER_MARK}${first}`, ...lines.slice(1)];
}

/**
 * Joins split Markdown lines with their original line separators.
 *
 * @param lines - line text to join.
 * @param lineSeparators - separator that followed each original line.
 * @returns Markdown text with the original line ending style preserved.
 */
export function joinMarkdownLines(
  lines: ReadonlyArray<string>,
  lineSeparators: ReadonlyArray<'' | LineSeparator>,
): string {
  return lines
    .map((line, index) => `${line}${lineSeparators[index] ?? ''}`)
    .join('');
}

/**
 * Returns the start offset for each line using either per-line separators or one shared separator.
 *
 * @param lines - Markdown lines to measure.
 * @param lineSeparators - either one separator for every line or the original per-line separators.
 * @returns Markdown offsets where each line starts.
 */
export function getLineStartOffsets(
  lines: ReadonlyArray<string>,
  lineSeparators: LineSeparator | ReadonlyArray<'' | LineSeparator>,
): ReadonlyArray<MarkdownOffset> {
  const offsets = [toMarkdownOffset(0)];
  let offset = 0;

  for (let index = 0; index < lines.length - 1; index++) {
    const line = lines[index];

    if (line === undefined) {
      break;
    }

    let lineSeparator: '' | LineSeparator = '';

    if (typeof lineSeparators === 'string') {
      lineSeparator = lineSeparators;
    } else {
      lineSeparator = lineSeparators[index] ?? '';
    }

    offset += line.length + lineSeparator.length;
    offsets.push(toMarkdownOffset(offset));
  }

  return offsets;
}

/**
 * Finds the small line window that can affect a requested normalization range.
 *
 * @param lines - Markdown lines in the document.
 * @param lineStartOffsets - Markdown offsets where each line starts.
 * @param range - requested normalization range, or `undefined` for the full document.
 * @returns line indexes to scan with one line of context on each side.
 */
export function getRangeLineWindow(
  lines: ReadonlyArray<string>,
  lineStartOffsets: ReadonlyArray<MarkdownOffset>,
  range: NormalizationRange | undefined,
): LineRange {
  if (lines.length === 0) {
    return {
      end: toLineIndex(0),
      start: toLineIndex(0),
    };
  }

  if (range === undefined) {
    return {
      end: toLineIndex(lines.length - 1),
      start: toLineIndex(0),
    };
  }

  const startLine = findLineIndexForMarkdownOffset(
    lineStartOffsets,
    range.start,
  );
  let endOffset = range.end;

  if (range.end !== range.start) {
    endOffset = toMarkdownOffset(Math.max(0, range.end - 1));
  }

  const endLine = findLineIndexForMarkdownOffset(lineStartOffsets, endOffset);

  return {
    end: toLineIndex(Math.min(lines.length - 1, endLine + 1)),
    start: toLineIndex(Math.max(0, startLine - 1)),
  };
}

/**
 * Validates Prettier range options and resolves missing bounds to the full Markdown length.
 *
 * @param markdownLength - total Markdown text length.
 * @param options - unchecked range options from the caller or Prettier.
 * @returns checked range bounds, or `undefined` when no range was requested.
 * @throws Error when range bounds are outside the Markdown text or inverted.
 */
export function getNormalizationRange(
  markdownLength: MarkdownOffset,
  options: UncheckedNormalizeMarkdownTablesOptions,
): NormalizationRange | undefined {
  if (options.rangeStart === undefined && options.rangeEnd === undefined) {
    return undefined;
  }

  const start = options.rangeStart ?? 0;
  const end = options.rangeEnd ?? markdownLength;

  if (!isValidRangeOffset(start, markdownLength)) {
    throw new Error(
      `Invalid rangeStart "${describeUnknownValue(
        start,
      )}" — expected an integer between 0 and ${markdownLength}.`,
    );
  }

  let resolvedEnd: MarkdownOffset;

  if (end === Number.POSITIVE_INFINITY) {
    resolvedEnd = markdownLength;
  } else if (!isValidRangeOffset(end, markdownLength)) {
    throw new Error(
      `Invalid rangeEnd "${describeUnknownValue(
        end,
      )}" — expected an integer between 0 and ${markdownLength}.`,
    );
  } else {
    resolvedEnd = toMarkdownOffset(end);
  }

  if (start > resolvedEnd) {
    throw new Error(
      `Invalid normalization range: rangeStart "${describeUnknownValue(
        start,
      )}" must be less than or equal to rangeEnd "${describeUnknownValue(
        resolvedEnd,
      )}".`,
    );
  }

  return {
    end: resolvedEnd,
    start: toMarkdownOffset(start),
  };
}

function isValidRangeOffset(
  value: unknown,
  markdownLength: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= markdownLength
  );
}

function findLineIndexForMarkdownOffset(
  lineStartOffsets: ReadonlyArray<MarkdownOffset>,
  offset: MarkdownOffset,
): LineIndex {
  let lineIndex = 0;

  for (let index = 1; index < lineStartOffsets.length; index++) {
    const lineStart = lineStartOffsets[index];

    if (lineStart === undefined || lineStart > offset) {
      break;
    }

    lineIndex = index;
  }

  return toLineIndex(lineIndex);
}

/**
 * Checks whether a table overlaps the requested range, including carets that touch table text.
 *
 * @param startLine - first line in the table block.
 * @param lineCount - number of lines in the table block.
 * @param lines - all Markdown lines.
 * @param lineStartOffsets - Markdown offsets where each line starts.
 * @param markdownLength - total Markdown text length.
 * @param range - checked normalization range, or `undefined` for the full document.
 * @returns `true` when the table should be normalized.
 */
export function tableBlockIntersectsRange(
  startLine: LineIndex,
  lineCount: number,
  lines: ReadonlyArray<string>,
  lineStartOffsets: ReadonlyArray<MarkdownOffset>,
  markdownLength: MarkdownOffset,
  range: NormalizationRange | undefined,
): boolean {
  if (range === undefined) {
    return true;
  }

  const tableStart = lineStartOffsets[startLine] ?? markdownLength;
  const lastLineIndex = toLineIndex(startLine + lineCount - 1);
  const lastLineStart = lineStartOffsets[lastLineIndex] ?? markdownLength;
  const lastLine = lines[lastLineIndex] ?? '';
  const tableTextEnd = toMarkdownOffset(lastLineStart + lastLine.length);

  // Caret-style ranges include the table when the caret touches table text.
  // Carets on surrounding blank lines stay outside the table.
  if (range.start === range.end) {
    return range.start >= tableStart && range.start <= tableTextEnd;
  }

  return tableStart < range.end && tableTextEnd > range.start;
}

/**
 * Finds the last following line that stays inside the same compatible Markdown container.
 *
 * @param containerKeys - parsed container key for each line.
 * @param start - line index where the protected region starts.
 * @returns the final compatible line index.
 */
export function findCompatibleContainerEnd(
  containerKeys: ReadonlyArray<ContainerKey>,
  start: number,
): number {
  const containerKey = containerKeys[start] ?? ROOT_CONTAINER_KEY;
  let end = start;

  for (let index = start + 1; index < containerKeys.length; index++) {
    if (
      !isCompatibleContainerKey(
        containerKeys[index] ?? ROOT_CONTAINER_KEY,
        containerKey,
      )
    ) {
      break;
    }

    end = index;
  }

  return end;
}

/**
 * Checks whether a later line belongs to the same Markdown container context.
 *
 * @param key - container key for the later line.
 * @param startKey - container key for the first line.
 * @returns `true` when a protected region can continue onto the later line.
 */
export function isCompatibleContainerKey(
  key: ContainerKey,
  startKey: ContainerKey,
): boolean {
  if (key === startKey) {
    return true;
  }

  if (startKey === ROOT_CONTAINER_KEY) {
    return key.startsWith('indent');
  }

  if (key.startsWith(`${startKey}/indent`)) {
    return true;
  }

  if (!startKey.endsWith('/list')) {
    return false;
  }

  const parentKey = startKey.slice(0, -'/list'.length);

  return key === parentKey || key.startsWith(`${parentKey}/indent`);
}

/**
 * Checks whether the line before a start index contains non-space text.
 *
 * @param lines - Markdown lines to inspect.
 * @param start - line index whose previous line should be checked.
 * @returns `true` when the previous line exists and is not blank.
 */
export function isPreviousLineNonBlank(
  lines: ReadonlyArray<string>,
  start: number,
): boolean {
  if (start === 0) {
    return false;
  }

  return lines[start - 1]?.trim() !== '';
}

/**
 * Measures leading Markdown indentation in source columns and string offsets.
 *
 * @param value - line text to scan.
 * @returns indentation width in Markdown columns and source offset units.
 */
export function scanMarkdownIndent(value: string): MarkdownIndent {
  let offset = 0;

  while (offset < value.length) {
    const char = value[offset];

    if (char !== ' ' && char !== '\t') {
      break;
    }

    offset++;
  }

  return {
    column: countMarkdownColumns(value, offset),
    offset: toMarkdownOffset(offset),
  };
}

/**
 * Counts Markdown columns through a string offset, expanding tabs to four-column stops.
 *
 * @param value - line text to measure.
 * @param end - string offset where measurement stops.
 * @returns Markdown column count at the requested offset.
 */
export function countMarkdownColumns(
  value: string,
  end: MarkdownOffset | number,
): MarkdownColumn {
  let column = 0;

  for (let index = 0; index < end; index++) {
    const char = value[index];

    if (char === '\t') {
      column += MARKDOWN_TAB_WIDTH - (column % MARKDOWN_TAB_WIDTH);
      continue;
    }

    column++;
  }

  return toMarkdownColumn(column);
}

/**
 * Brands a checked positive table column count.
 *
 * @param value - raw column count to check.
 * @returns the branded column count.
 * @throws Error when the value is not a positive whole number.
 */
export function toColumnCount(value: number): ColumnCount {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `Invalid table column count "${String(
        value,
      )}" — expected a positive whole number.`,
    );
  }

  return value as ColumnCount;
}

/**
 * Brands a checked zero-based line index.
 *
 * @param value - raw line index to check.
 * @returns the branded line index.
 * @throws Error when the value is not a whole number at or above 0.
 */
export function toLineIndex(value: number): LineIndex {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `Invalid line index "${String(
        value,
      )}" — expected a whole number at or above 0.`,
    );
  }

  return value as LineIndex;
}

/**
 * Brands a checked Markdown column number.
 *
 * @param value - raw column number to check.
 * @returns the branded Markdown column.
 * @throws Error when the value is not a whole number at or above 0.
 */
export function toMarkdownColumn(value: number): MarkdownColumn {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `Invalid Markdown column "${String(
        value,
      )}" — expected a whole number at or above 0.`,
    );
  }

  return value as MarkdownColumn;
}

/**
 * Brands a checked offset in original Markdown text.
 *
 * @param value - raw Markdown offset to check.
 * @returns the branded Markdown offset.
 * @throws Error when the value is not a whole number at or above 0.
 */
export function toMarkdownOffset(value: number): MarkdownOffset {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `Invalid Markdown offset "${String(
        value,
      )}" — expected a whole number at or above 0.`,
    );
  }

  return value as MarkdownOffset;
}

/**
 * Brands a checked offset in normalized Markdown text.
 *
 * @param value - raw normalized offset to check.
 * @returns the branded normalized offset.
 * @throws Error when the value is not a whole number at or above 0.
 */
export function toNormalizedOffset(value: number): NormalizedOffset {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `Invalid normalized offset "${String(
        value,
      )}" — expected a whole number at or above 0.`,
    );
  }

  return value as NormalizedOffset;
}

/**
 * Brands a checked offset in joined MDX JSX scan text.
 *
 * @param value - raw scan text offset to check.
 * @returns the branded scan text offset.
 * @throws Error when the value is not a whole number at or above 0.
 */
export function toScanTextOffset(value: number): ScanTextOffset {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `Invalid scan text offset "${String(
        value,
      )}" — expected a whole number at or above 0.`,
    );
  }

  return value as ScanTextOffset;
}

/**
 * Counts a repeated character run starting at one string offset.
 *
 * @param value - text to scan.
 * @param start - offset where the run starts.
 * @param char - character expected in the run.
 * @returns number of repeated characters from the start offset.
 */
export function countRun(value: string, start: number, char: string): number {
  let count = 0;

  while (start + count < value.length && value[start + count] === char) {
    count++;
  }

  return count;
}

/**
 * Checks whether a Markdown character is escaped by an odd number of backslashes.
 *
 * @param value - Markdown text to inspect.
 * @param index - character offset to test.
 * @returns `true` when the character has a Markdown escape before it.
 */
export function isMarkdownEscapedCharacter(
  value: string,
  index: number,
): boolean {
  return countBackslashesBeforeIndex(value, index) % 2 === 1;
}

function countBackslashesBeforeIndex(value: string, index: number): number {
  let backslashCount = 0;

  for (let cursor = index - 1; cursor >= 0; cursor--) {
    if (value[cursor] !== '\\') {
      break;
    }

    backslashCount++;
  }

  return backslashCount;
}
