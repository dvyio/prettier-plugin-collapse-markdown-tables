/**
 * @fileoverview Keeps Prettier range and cursor offsets aligned after parser preprocessing changes Markdown text.
 */

import type { ParserOptions } from 'prettier';

import type { MarkdownOffset, NormalizedOffset } from './normalizer/types.js';

import {
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
export function remapPrettierRangeStateAfterPreprocess(
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
 * Maps Prettier range offsets from one Markdown string to another.
 */
export function mapPrettierRangeStateToMarkdown(
  options: ParserOptions,
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
    ),
    rangeStart: mapRangeStartToNormalized(
      original,
      normalized,
      rangeState.rangeStart,
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

function readPrettierRangeState(options: ParserOptions): PrettierRangeState {
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
    ),
    rangeStart: mapRangeStartToNormalized(
      original,
      normalized,
      rangeState.rangeStart,
    ),
  };

  if (rangeState.cursorOffset !== undefined) {
    mappedRangeState.cursorOffset = mapOriginalOffsetToNormalized(
      original,
      normalized,
      rangeState.cursorOffset,
    );
  }

  return mappedRangeState;
}

function readOptionalMarkdownOffset(
  options: ParserOptions,
  key: 'cursorOffset' | 'rangeEnd' | 'rangeStart',
): MarkdownOffset | undefined {
  const value = readNumberOption(options, key);

  if (value === undefined || value === Number.POSITIVE_INFINITY || value < 0) {
    return undefined;
  }

  return toMarkdownOffset(value);
}

function readNumberOption(
  options: ParserOptions,
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
  options: ParserOptions,
  key: PrettierRangeOptionKey,
): unknown {
  return readOwnDataOption(options, key);
}

function mapRangeStartToNormalized(
  original: string,
  normalized: string,
  rangeStart: MarkdownOffset | undefined,
): NormalizedOffset {
  return mapOriginalOffsetToNormalized(
    original,
    normalized,
    rangeStart ?? toMarkdownOffset(0),
  );
}

function mapRangeEndToNormalized(
  original: string,
  normalized: string,
  rangeEnd: MarkdownOffset | undefined,
  isRangeEndInfinity: boolean,
): NormalizedOffset {
  if (rangeEnd === undefined || isRangeEndInfinity) {
    return toNormalizedOffset(normalized.length);
  }

  return mapOriginalOffsetToNormalized(original, normalized, rangeEnd);
}

function mapOriginalOffsetToNormalized(
  original: string,
  normalized: string,
  offset: MarkdownOffset,
): NormalizedOffset {
  if (!Number.isInteger(offset) || offset < 0 || offset > original.length) {
    throw new Error(
      `Invalid offset "${String(offset)}" — expected an integer between 0 and ${
        original.length
      }.`,
    );
  }

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

  return toNormalizedOffset(
    prefixLength +
      mapChangedColumnToNormalized(
        original.slice(prefixLength, originalSuffixStart),
        normalized.slice(prefixLength, normalized.length - suffixLength),
        logicalOffset - prefixLength,
      ),
  );
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
