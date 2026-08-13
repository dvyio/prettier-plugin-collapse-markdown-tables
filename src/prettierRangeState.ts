/**
 * @fileoverview Keeps Prettier range and cursor offsets aligned after parser preprocessing changes Markdown text.
 */

import type { ParserOptions } from 'prettier';

import type { MarkdownOffset, NormalizedOffset } from './normalizer/types.js';

import {
  getLineStartOffsets,
  splitMarkdownLines,
  toMarkdownOffset,
  toNormalizedOffset,
} from './normalizer/lineUtils.js';
import { readOwnDataOption } from './normalizer/options.js';

const OFFSET_MAPPING_LOOKAHEAD = 64;
const preprocessedMarkdownByOptions = new WeakMap<
  object,
  PreprocessedMarkdownCacheEntry
>();

type PreprocessedMarkdownCacheEntry = {
  readonly normalizedText: string;
  readonly originalText: string;
};

type PrettierRangeOptionKey =
  | 'cursorOffset'
  | 'originalText'
  | 'rangeEnd'
  | 'rangeStart';

type PrettierRangeState = {
  readonly cursorOffset?: MarkdownOffset | undefined;
  readonly isRangeEndInfinity: boolean;
  readonly rangeEnd?: MarkdownOffset | undefined;
  readonly rangeStart?: MarkdownOffset | undefined;
};

type MappedPrettierRangeState = {
  readonly cursorOffset?: NormalizedOffset | undefined;
  readonly rangeEnd: NormalizedOffset;
  readonly rangeStart: NormalizedOffset;
};

type LinePreservingOffsetMappingContext = {
  readonly normalizedLines: ReadonlyArray<string>;
  readonly normalizedLineStartOffsets: ReadonlyArray<MarkdownOffset>;
  readonly originalLines: ReadonlyArray<string>;
  readonly originalLineStartOffsets: ReadonlyArray<MarkdownOffset>;
};

/**
 * Stores parser-preprocessed Markdown for the later root printer call.
 */
export function rememberPreprocessedMarkdown(
  options: ParserOptions,
  originalText: string,
  normalizedText: string,
): void {
  preprocessedMarkdownByOptions.set(options, {
    normalizedText,
    originalText,
  });
}

/**
 * Reads the Markdown source Prettier range offsets currently refer to.
 */
export function readKnownMarkdownSource(
  options: ParserOptions,
): string | undefined {
  const originalText = readOriginalText(options);
  const cacheEntry = preprocessedMarkdownByOptions.get(options);

  if (cacheEntry === undefined) {
    return originalText;
  }

  if (originalText === undefined) {
    return cacheEntry.normalizedText;
  }

  if (cacheEntry.originalText === originalText) {
    return cacheEntry.normalizedText;
  }

  return originalText;
}

/**
 * Clears parser-preprocessed Markdown once the matching root printer call has consumed it.
 */
export function forgetPreprocessedMarkdown(options: ParserOptions): void {
  preprocessedMarkdownByOptions.delete(options);
}

/**
 * Rewrites Prettier's range and cursor offsets after parser preprocessing changes Markdown text.
 */
export function remapPrettierRangeStateAfterLinePreservingPreprocess(
  options: ParserOptions,
  original: string,
  normalized: string,
): void {
  if (original === normalized) {
    return;
  }

  const rangeState = readPrettierRangeState(options);
  const mappedRangeState = mapPrettierRangeState(
    rangeState,
    original,
    normalized,
  );

  writePrettierRangeState(options, mappedRangeState);
}

/**
 * Rewrites Prettier's range and cursor offsets after known backslash insertions.
 */
export function remapPrettierRangeStateAfterInsertions(
  options: ParserOptions,
  original: string,
  insertedBackslashOffsets: ReadonlyArray<MarkdownOffset>,
): void {
  if (insertedBackslashOffsets.length === 0) {
    return;
  }

  const rangeState = readPrettierRangeState(options);
  let mappedRangeEnd = toNormalizedOffset(
    original.length + insertedBackslashOffsets.length,
  );

  if (rangeState.rangeEnd !== undefined && !rangeState.isRangeEndInfinity) {
    mappedRangeEnd = mapOffsetAfterInsertions(
      original,
      insertedBackslashOffsets,
      rangeState.rangeEnd,
    );
  }

  const mappedRangeState: {
    cursorOffset?: NormalizedOffset | undefined;
    rangeEnd: NormalizedOffset;
    rangeStart: NormalizedOffset;
  } = {
    rangeEnd: mappedRangeEnd,
    rangeStart: mapOffsetAfterInsertions(
      original,
      insertedBackslashOffsets,
      rangeState.rangeStart ?? toMarkdownOffset(0),
    ),
  };

  if (rangeState.cursorOffset !== undefined) {
    mappedRangeState.cursorOffset = mapOffsetAfterInsertions(
      original,
      insertedBackslashOffsets,
      rangeState.cursorOffset,
    );
  }

  writePrettierRangeState(options, mappedRangeState);
}

function mapOffsetAfterInsertions(
  original: string,
  insertionOffsets: ReadonlyArray<MarkdownOffset>,
  offset: MarkdownOffset,
): NormalizedOffset {
  assertValidOriginalOffset(original, offset);

  const logicalOffset = normalizeCrLfSeparatorOffset(original, offset);

  return toNormalizedOffset(
    logicalOffset +
      countInsertionOffsetsBefore(insertionOffsets, logicalOffset),
  );
}

/**
 * Maps Prettier range offsets from one Markdown string to another.
 */
export function mapPrettierRangeStateToMarkdown(
  options: object,
  original: string,
  normalized: string,
): MappedPrettierRangeState {
  const rangeState = readPrettierRangeState(options);

  return {
    rangeEnd: mapRangeEndToNormalized(
      original,
      normalized,
      rangeState.rangeEnd,
      rangeState.isRangeEndInfinity,
      undefined,
    ),
    rangeStart: mapRangeStartToNormalized(
      original,
      normalized,
      rangeState.rangeStart,
      undefined,
    ),
  };
}

/**
 * Checks whether Prettier provided range-formatting options.
 */
export function hasPrettierRangeFormatOptions(options: ParserOptions): boolean {
  const rangeState = readPrettierRangeState(options);

  return (
    rangeState.rangeEnd !== undefined || rangeState.rangeStart !== undefined
  );
}

function readOriginalText(options: ParserOptions): string | undefined {
  const originalText = readOptionValue(options, 'originalText');

  return typeof originalText === 'string' ? originalText : undefined;
}

function readPrettierRangeState(options: object): PrettierRangeState {
  return {
    cursorOffset: readOptionalMarkdownOffset(options, 'cursorOffset'),
    isRangeEndInfinity:
      readNumberOption(options, 'rangeEnd') === Number.POSITIVE_INFINITY,
    rangeEnd: readOptionalMarkdownOffset(options, 'rangeEnd'),
    rangeStart: readOptionalMarkdownOffset(options, 'rangeStart'),
  };
}

function writePrettierRangeState(
  options: ParserOptions,
  rangeState: MappedPrettierRangeState,
): void {
  // Prettier reads these fields after parser preprocess runs. Keep this write at the boundary.
  options.rangeStart = rangeState.rangeStart;
  options.rangeEnd = rangeState.rangeEnd;

  if (rangeState.cursorOffset !== undefined) {
    options.cursorOffset = rangeState.cursorOffset;
  }
}

function mapPrettierRangeState(
  rangeState: PrettierRangeState,
  original: string,
  normalized: string,
): MappedPrettierRangeState {
  const context = createLinePreservingOffsetMappingContext(
    original,
    normalized,
  );
  const mappedRangeState: {
    cursorOffset?: NormalizedOffset | undefined;
    rangeEnd: NormalizedOffset;
    rangeStart: NormalizedOffset;
  } = {
    rangeEnd: mapRangeEndToNormalized(
      original,
      normalized,
      rangeState.rangeEnd,
      rangeState.isRangeEndInfinity,
      context,
    ),
    rangeStart: mapRangeStartToNormalized(
      original,
      normalized,
      rangeState.rangeStart,
      context,
    ),
  };

  if (rangeState.cursorOffset !== undefined) {
    mappedRangeState.cursorOffset = mapOriginalOffsetToNormalized(
      original,
      normalized,
      rangeState.cursorOffset,
      context,
    );
  }

  return mappedRangeState;
}

function readOptionalMarkdownOffset(
  options: object,
  key: 'cursorOffset' | 'rangeEnd' | 'rangeStart',
): MarkdownOffset | undefined {
  const value = readNumberOption(options, key);

  if (value === undefined || value === Number.POSITIVE_INFINITY || value < 0) {
    return undefined;
  }

  return toMarkdownOffset(value);
}

function readNumberOption(
  options: object,
  key: PrettierRangeOptionKey,
): number | undefined {
  const value = readOptionValue(options, key);

  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'number') {
    return value;
  }

  throw new Error(
    `Invalid Prettier option "${key}" — expected a number or undefined.`,
  );
}

function readOptionValue(
  options: object,
  key: PrettierRangeOptionKey,
): unknown {
  return readOwnDataOption(options, key);
}

function mapRangeStartToNormalized(
  original: string,
  normalized: string,
  rangeStart: MarkdownOffset | undefined,
  context: LinePreservingOffsetMappingContext | undefined,
): NormalizedOffset {
  return mapOriginalOffsetToNormalized(
    original,
    normalized,
    rangeStart ?? toMarkdownOffset(0),
    context,
  );
}

function mapRangeEndToNormalized(
  original: string,
  normalized: string,
  rangeEnd: MarkdownOffset | undefined,
  isRangeEndInfinity: boolean,
  context: LinePreservingOffsetMappingContext | undefined,
): NormalizedOffset {
  if (rangeEnd === undefined || isRangeEndInfinity) {
    return toNormalizedOffset(normalized.length);
  }

  return mapOriginalOffsetToNormalized(original, normalized, rangeEnd, context);
}

function mapOriginalOffsetToNormalized(
  original: string,
  normalized: string,
  offset: MarkdownOffset,
  context: LinePreservingOffsetMappingContext | undefined,
): NormalizedOffset {
  assertValidOriginalOffset(original, offset);

  const logicalOffset = normalizeCrLfSeparatorOffset(original, offset);

  if (original === normalized) {
    return toNormalizedOffset(logicalOffset);
  }

  const prefixLength = getSharedPrefixLength(original, normalized);

  if (logicalOffset <= prefixLength) {
    return toNormalizedOffset(logicalOffset);
  }

  const suffixLength = getSharedSuffixLength(
    original,
    normalized,
    prefixLength,
  );
  const originalSuffixStart = original.length - suffixLength;

  if (logicalOffset >= originalSuffixStart) {
    return toNormalizedOffset(
      normalized.length - suffixLength + logicalOffset - originalSuffixStart,
    );
  }

  const lineMappedOffset = mapOffsetWithinSameLine(logicalOffset, context);

  if (lineMappedOffset !== undefined) {
    return toNormalizedOffset(lineMappedOffset);
  }

  return toNormalizedOffset(
    prefixLength +
      mapChangedColumnToNormalized(
        original.slice(prefixLength, originalSuffixStart),
        normalized.slice(prefixLength, normalized.length - suffixLength),
        logicalOffset - prefixLength,
      ),
  );
}

function assertValidOriginalOffset(
  original: string,
  offset: MarkdownOffset,
): void {
  if (!Number.isInteger(offset) || offset < 0 || offset > original.length) {
    throw new Error(
      `Invalid offset "${String(offset)}" — expected an integer between 0 and ${
        original.length
      }.`,
    );
  }
}

function createLinePreservingOffsetMappingContext(
  original: string,
  normalized: string,
): LinePreservingOffsetMappingContext | undefined {
  const originalMarkdownLines = splitMarkdownLines(original);
  const normalizedMarkdownLines = splitMarkdownLines(normalized);

  if (
    originalMarkdownLines.lines.length !== normalizedMarkdownLines.lines.length
  ) {
    return undefined;
  }

  return {
    normalizedLines: normalizedMarkdownLines.lines,
    normalizedLineStartOffsets: getLineStartOffsets(
      normalizedMarkdownLines.lines,
      normalizedMarkdownLines.lineSeparators,
    ),
    originalLines: originalMarkdownLines.lines,
    originalLineStartOffsets: getLineStartOffsets(
      originalMarkdownLines.lines,
      originalMarkdownLines.lineSeparators,
    ),
  };
}

function mapOffsetWithinSameLine(
  offset: number,
  context: LinePreservingOffsetMappingContext | undefined,
): number | undefined {
  if (context === undefined) {
    return undefined;
  }

  const lineIndex = findLineIndexAtOffset(
    context.originalLineStartOffsets,
    offset,
  );
  const originalLine = context.originalLines[lineIndex];
  const normalizedLine = context.normalizedLines[lineIndex];
  const originalLineStart = context.originalLineStartOffsets[lineIndex];
  const normalizedLineStart = context.normalizedLineStartOffsets[lineIndex];

  if (
    originalLine === undefined ||
    normalizedLine === undefined ||
    originalLineStart === undefined ||
    normalizedLineStart === undefined
  ) {
    return undefined;
  }

  const originalColumn = Math.min(
    offset - originalLineStart,
    originalLine.length,
  );

  return (
    normalizedLineStart +
    mapChangedColumnToNormalized(originalLine, normalizedLine, originalColumn)
  );
}

function findLineIndexAtOffset(
  lineStartOffsets: ReadonlyArray<MarkdownOffset>,
  offset: number,
): number {
  let low = 0;
  let high = lineStartOffsets.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const lineStart = lineStartOffsets[middle];

    if (lineStart !== undefined && lineStart <= offset) {
      low = middle + 1;
      continue;
    }

    high = middle - 1;
  }

  return Math.max(0, high);
}

function normalizeCrLfSeparatorOffset(
  text: string,
  offset: MarkdownOffset,
): MarkdownOffset {
  if (text[offset - 1] === '\r' && text[offset] === '\n') {
    return toMarkdownOffset(offset + 1);
  }

  return offset;
}

function countInsertionOffsetsBefore(
  insertionOffsets: ReadonlyArray<MarkdownOffset>,
  offset: MarkdownOffset,
): number {
  let low = 0;
  let high = insertionOffsets.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const insertionOffset = insertionOffsets[middle];

    if (insertionOffset !== undefined && insertionOffset < offset) {
      low = middle + 1;
      continue;
    }

    high = middle;
  }

  return low;
}

function getSharedPrefixLength(left: string, right: string): number {
  const length = Math.min(left.length, right.length);

  for (let index = 0; index < length; index++) {
    if (left[index] !== right[index]) {
      return index;
    }
  }

  return length;
}

function getSharedSuffixLength(
  left: string,
  right: string,
  prefixLength: number,
): number {
  const maxLength = Math.min(left.length, right.length) - prefixLength;

  for (let index = 0; index < maxLength; index++) {
    if (left[left.length - index - 1] !== right[right.length - index - 1]) {
      return index;
    }
  }

  return maxLength;
}

function mapChangedColumnToNormalized(
  originalText: string,
  normalizedText: string,
  column: number,
): number {
  let originalIndex = 0;
  let normalizedIndex = 0;

  while (originalIndex < column) {
    if (originalText[originalIndex] === normalizedText[normalizedIndex]) {
      originalIndex++;
      normalizedIndex++;
      continue;
    }

    if (
      originalText[originalIndex] === ' ' &&
      originalText[originalIndex + 1] !== normalizedText[normalizedIndex]
    ) {
      originalIndex++;
      continue;
    }

    if (
      normalizedText[normalizedIndex] === ' ' &&
      originalText[originalIndex] !== normalizedText[normalizedIndex + 1]
    ) {
      normalizedIndex++;
      continue;
    }

    const originalDistance = getNextIndexDistanceWithinLookahead(
      originalText,
      normalizedText[normalizedIndex],
      originalIndex,
    );
    const normalizedDistance = getNextIndexDistanceWithinLookahead(
      normalizedText,
      originalText[originalIndex],
      normalizedIndex,
    );

    if (
      originalDistance === Number.POSITIVE_INFINITY &&
      normalizedDistance === Number.POSITIVE_INFINITY
    ) {
      return mapUnmatchedChangedColumnToNormalized(
        originalText,
        normalizedText,
        column,
        originalIndex,
        normalizedIndex,
      );
    }

    if (originalDistance <= normalizedDistance) {
      originalIndex++;
      continue;
    }

    normalizedIndex++;
  }

  return normalizedIndex;
}

function getNextIndexDistanceWithinLookahead(
  text: string,
  target: string | undefined,
  start: number,
): number {
  if (target === undefined) {
    return Number.POSITIVE_INFINITY;
  }

  const end = Math.min(text.length, start + OFFSET_MAPPING_LOOKAHEAD + 1);

  for (let index = start; index < end; index++) {
    if (text[index] === target) {
      return index - start;
    }
  }

  return Number.POSITIVE_INFINITY;
}

function mapUnmatchedChangedColumnToNormalized(
  originalText: string,
  normalizedText: string,
  column: number,
  originalIndex: number,
  normalizedIndex: number,
): number {
  const remainingOriginalLength = originalText.length - originalIndex;
  const remainingNormalizedLength = normalizedText.length - normalizedIndex;

  if (remainingOriginalLength <= 0 || remainingNormalizedLength <= 0) {
    return normalizedIndex;
  }

  const remainingColumn = column - originalIndex;
  const mappedRemainingColumn = Math.round(
    (remainingColumn / remainingOriginalLength) * remainingNormalizedLength,
  );

  return Math.min(
    normalizedText.length,
    normalizedIndex + mappedRemainingColumn,
  );
}
