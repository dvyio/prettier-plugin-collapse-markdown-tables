/**
 * @fileoverview Reads Prettier Markdown plugin options and maps them to normalizer options.
 */

import type { ParserOptions } from 'prettier';

import type {
  MarkdownTableFencedCode,
  MarkdownTableStyle,
  NormalizeMarkdownTablesOptions,
} from './normalizeMarkdownTables.js';

import {
  getNormalizationRange,
  toMarkdownOffset,
} from './normalizer/lineUtils.js';
import {
  describeUnknownValue,
  parseMarkdownTableFencedCode,
  parseMarkdownTableStyle,
  readOwnDataOption,
} from './normalizer/options.js';
import {
  hasPrettierRangeFormatOptions,
  mapPrettierRangeStateToMarkdown,
  readKnownMarkdownSource,
} from './prettierRangeState.js';

type MarkdownPluginOptions = {
  readonly markdownTableFencedCode: MarkdownTableFencedCode;
  readonly markdownTableStyle: MarkdownTableStyle;
  readonly parentParser?: string | undefined;
  readonly parser?: string | undefined;
  readonly rangeEnd?: number | undefined;
  readonly rangeStart?: number | undefined;
};

type MutableNormalizeMarkdownTablesOptions = {
  enableMdxEsm?: boolean;
  enableMdxJsx?: boolean;
  markdownTableFencedCode?: MarkdownTableFencedCode;
  markdownTableStyle?: MarkdownTableStyle;
  rangeEnd?: number;
  rangeStart?: number;
};

/**
 * Reads table style, parser names, and range offsets without invoking option getters.
 */
export function readMarkdownPluginOptions(
  options: ParserOptions,
  markdownLength?: number,
): MarkdownPluginOptions {
  const markdownTableStyle = parseMarkdownTableStyle(
    readOwnDataOption(options, 'markdownTableStyle'),
  );
  const markdownTableFencedCode = parseMarkdownTableFencedCode(
    readOwnDataOption(options, 'markdownTableFencedCode'),
  );
  const rangeEnd = readOptionalNumberPluginOption(options, 'rangeEnd');
  const rangeStart = readOptionalNumberPluginOption(options, 'rangeStart');

  if (markdownLength !== undefined) {
    getNormalizationRange(toMarkdownOffset(markdownLength), {
      rangeEnd,
      rangeStart,
    });
  }

  return {
    markdownTableFencedCode,
    markdownTableStyle,
    parentParser: readOptionalStringPluginOption(options, 'parentParser'),
    parser: readOptionalStringPluginOption(options, 'parser'),
    rangeEnd,
    rangeStart,
  };
}

/**
 * Checks whether Prettier requested a range smaller than the full Markdown text.
 */
export function isPartialMarkdownPluginRangeFormat(
  options: MarkdownPluginOptions,
  markdownLength: number,
): boolean {
  const rangeStart = options.rangeStart ?? 0;
  const rangeEnd = options.rangeEnd ?? markdownLength;

  return rangeStart > 0 || rangeEnd < markdownLength;
}

/**
 * Builds helper options for parser preprocessing and shifts CRLF range edges to whole line breaks.
 */
export function getPreprocessedNormalizeOptions(
  options: MarkdownPluginOptions,
  markdown: string,
  enableMdxEsm: boolean,
  enableMdxJsx: boolean,
): NormalizeMarkdownTablesOptions {
  const normalizeOptions = getBaseNormalizeOptions(
    options,
    enableMdxEsm,
    enableMdxJsx,
  );

  if (isPartialMarkdownPluginRangeFormat(options, markdown.length)) {
    if (options.rangeEnd === Number.POSITIVE_INFINITY) {
      normalizeOptions.rangeEnd = options.rangeEnd;
    } else if (options.rangeEnd !== undefined) {
      normalizeOptions.rangeEnd = normalizeCrLfSeparatorOffset(
        markdown,
        options.rangeEnd,
      );
    }

    if (options.rangeStart !== undefined) {
      normalizeOptions.rangeStart = normalizeCrLfSeparatorOffset(
        markdown,
        options.rangeStart,
      );
    }
  }

  return normalizeOptions;
}

/**
 * Builds helper options for root printing and maps Prettier ranges to printed Markdown.
 */
export function getPrintedNormalizeOptions(
  options: ParserOptions,
  pluginOptions: MarkdownPluginOptions,
  formatted: string,
  enableMdxEsm: boolean,
  enableMdxJsx: boolean,
): NormalizeMarkdownTablesOptions {
  const normalizeOptions = getBaseNormalizeOptions(
    pluginOptions,
    enableMdxEsm,
    enableMdxJsx,
  );
  const rangeCoordinateSource = readKnownMarkdownSource(options);

  if (rangeCoordinateSource === undefined) {
    if (hasPrettierRangeFormatOptions(options)) {
      throw new Error(
        'Cannot map Markdown table range because Prettier did not provide originalText. Format the full document or pass originalText in the parser options.',
      );
    }

    return normalizeOptions;
  }

  const rangeOptions = readMarkdownPluginOptions(
    options,
    rangeCoordinateSource.length,
  );

  if (
    isPartialMarkdownPluginRangeFormat(
      rangeOptions,
      rangeCoordinateSource.length,
    )
  ) {
    const mappedRangeState = mapPrettierRangeStateToMarkdown(
      options,
      rangeCoordinateSource,
      formatted,
    );
    normalizeOptions.rangeEnd = mappedRangeState.rangeEnd;
    normalizeOptions.rangeStart = mappedRangeState.rangeStart;
  }

  return normalizeOptions;
}

function getBaseNormalizeOptions(
  options: MarkdownPluginOptions,
  enableMdxEsm: boolean,
  enableMdxJsx: boolean,
): MutableNormalizeMarkdownTablesOptions {
  const normalizeOptions: MutableNormalizeMarkdownTablesOptions = {};

  if (enableMdxEsm) {
    normalizeOptions.enableMdxEsm = true;
  }

  if (enableMdxJsx) {
    normalizeOptions.enableMdxJsx = true;
  }

  if (options.markdownTableStyle !== undefined) {
    normalizeOptions.markdownTableStyle = options.markdownTableStyle;
  }

  if (options.markdownTableFencedCode !== undefined) {
    normalizeOptions.markdownTableFencedCode = options.markdownTableFencedCode;
  }

  return normalizeOptions;
}

function readOptionalNumberPluginOption(
  options: ParserOptions,
  key: 'rangeEnd' | 'rangeStart',
): number | undefined {
  const value = readOwnDataOption(options, key);

  if (value === undefined || typeof value === 'number') {
    return value;
  }

  throw new Error(
    `Invalid ${key} "${describeUnknownValue(
      value,
    )}" — expected a number or undefined.`,
  );
}

function readOptionalStringPluginOption(
  options: ParserOptions,
  key: 'parentParser' | 'parser',
): string | undefined {
  const value = readOwnDataOption(options, key);

  if (value === undefined || typeof value === 'string') {
    return value;
  }

  throw new Error(
    `Invalid ${key} "${describeUnknownValue(
      value,
    )}" — expected a string or undefined.`,
  );
}

function normalizeCrLfSeparatorOffset(text: string, offset: number): number {
  if (text[offset - 1] === '\r' && text[offset] === '\n') {
    return offset + 1;
  }

  return offset;
}
