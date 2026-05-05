/**
 * @fileoverview Normalizes Markdown tables after Prettier has formatted the file.
 */

import { Buffer } from 'node:buffer';

import type {
  MarkdownTableStyle as NormalizerMarkdownTableStyle,
  ParsedMarkdownTableRow as NormalizerParsedMarkdownTableRow,
  TableRowPrefix as NormalizerTableRowPrefix,
} from './normalizer/publicTypes.js';

import {
  addRootByteOrderMark,
  getLineStartOffsets,
  getNormalizationRange,
  getRangeLineWindow,
  joinMarkdownLines,
  splitMarkdownLines,
  tableBlockIntersectsRange,
  toLineIndex,
  toMarkdownOffset,
} from './normalizer/lineUtils.js';
import {
  describeUnknownValue,
  parseMarkdownTableStyle,
  readNormalizeMarkdownTablesOptions,
} from './normalizer/options.js';
import { findProtectedLines } from './normalizer/protectedRegions.js';
import { normalizeTableBlock } from './normalizer/tableRender.js';
import {
  expandLineWindowToAdjacentPipedRows,
  findMarkdownTableBlock,
  lineWindowContainsTableInRange,
  mayContainMarkdownTableCandidate,
} from './normalizer/tableRows.js';

/** Table output style accepted by the public helper and Prettier option. */
export type MarkdownTableStyle = NormalizerMarkdownTableStyle;

/** Parsed cells and repair metadata for one pipe-started Markdown table row. */
export type ParsedMarkdownTableRow = NormalizerParsedMarkdownTableRow;

/** Markdown prefix accepted before a pipe-started table row. */
export type TableRowPrefix = NormalizerTableRowPrefix;

/**
 * Controls how `normalizeMarkdownTables` rewrites tables and which parts of the
 * input it may touch.
 */
export type NormalizeMarkdownTablesOptions = {
  /**
   * Protect MDX ESM imports, exports, and flow expressions from table
   * rewriting. Use this only when the input is MDX.
   */
  readonly enableMdxEsm?: boolean;
  /**
   * Protect complete MDX JSX elements and fragments from table rewriting. Use
   * this only when the input is MDX. Unclosed JSX-like tags are not protected by
   * the MDX JSX scanner.
   */
  readonly enableMdxJsx?: boolean;
  /**
   * Table output style. `spaced` keeps one space inside each cell, `compact`
   * removes that padding, and `prettier` returns the input unchanged.
   */
  readonly markdownTableStyle?: MarkdownTableStyle;
  /**
   * Maximum UTF-8 byte size accepted by the helper. Use this when the input
   * comes from users or other untrusted sources.
   */
  readonly maxInputBytes?: number;
  /**
   * End offset for the part of the input that may be rewritten. Omit it to use
   * the end of the input. `Number.POSITIVE_INFINITY` is also accepted and means
   * the end of the input.
   */
  readonly rangeEnd?: number;
  /**
   * Start offset for the part of the input that may be rewritten. Omit it to
   * start at the beginning of the input.
   */
  readonly rangeStart?: number;
};

/**
 * Normalizes Prettier-formatted, pipe-wrapped Markdown tables in a string.
 *
 * The standalone helper leaves bare GFM table syntax unchanged. Run Markdown
 * through Prettier first when you want bare tables converted to pipe-wrapped
 * rows.
 *
 * @param markdown - Markdown text that has already been formatted by Prettier.
 * @param options - Table style, MDX protection, input size limit, and output range to use. The default keeps one space inside cells.
 * @returns Markdown with pipe-wrapped table rows rebuilt in the requested style. Existing CR, CRLF, and LF line endings are preserved per line.
 */
export function normalizeMarkdownTables(
  markdown: string,
  options?: NormalizeMarkdownTablesOptions,
): string;
export function normalizeMarkdownTables(
  markdown: unknown,
  options: unknown = {},
): string {
  if (typeof markdown !== 'string') {
    throw new Error(
      `Invalid markdown input "${describeUnknownValue(
        markdown,
      )}" - expected a string.`,
    );
  }

  const normalizeOptions = readNormalizeMarkdownTablesOptions(options);
  assertMarkdownInputSize(markdown, normalizeOptions.maxInputBytes);

  const tableStyle = parseMarkdownTableStyle(
    normalizeOptions.markdownTableStyle,
  );
  const markdownLength = toMarkdownOffset(markdown.length);
  const normalizationRange = getNormalizationRange(
    markdownLength,
    normalizeOptions,
  );

  if (tableStyle === 'prettier') {
    return markdown;
  }

  if (!mayContainMarkdownTableCandidate(markdown)) {
    return markdown;
  }

  const markdownLines = splitMarkdownLines(markdown);
  const lines = [...markdownLines.lines];
  const lineSeparators = markdownLines.lineSeparators;
  const lineStartOffsets = getLineStartOffsets(lines, lineSeparators);
  const tableSearchWindow = expandLineWindowToAdjacentPipedRows(
    lines,
    getRangeLineWindow(lines, lineStartOffsets, normalizationRange),
  );

  if (
    !lineWindowContainsTableInRange(
      lines,
      lineStartOffsets,
      markdownLength,
      normalizationRange,
      tableSearchWindow,
    )
  ) {
    return markdown;
  }

  const protectedLines = findProtectedLines(lines, normalizeOptions);

  for (
    let index: number = tableSearchWindow.start;
    index <= tableSearchWindow.end;
    index++
  ) {
    const tableBlock = findMarkdownTableBlock(lines, toLineIndex(index), {
      protectedLines,
    });

    if (tableBlock === undefined) {
      continue;
    }

    const headerLine = lines[index];

    if (headerLine === undefined) {
      continue;
    }

    if (
      !tableBlockIntersectsRange(
        tableBlock.start,
        tableBlock.lines.length,
        lines,
        lineStartOffsets,
        markdownLength,
        normalizationRange,
      )
    ) {
      continue;
    }

    const normalized = addRootByteOrderMark(
      normalizeTableBlock(tableBlock, tableStyle),
      headerLine,
      tableBlock.start,
    );
    lines.splice(tableBlock.start, tableBlock.lines.length, ...normalized);
    index = tableBlock.start + normalized.length - 1;
  }

  return joinMarkdownLines(lines, lineSeparators);
}

function assertMarkdownInputSize(
  markdown: string,
  maxInputBytes: number | undefined,
): void {
  if (maxInputBytes === undefined) {
    return;
  }

  const markdownInputBytes = Buffer.byteLength(markdown, 'utf8');

  if (markdownInputBytes <= maxInputBytes) {
    return;
  }

  throw new Error(
    `Markdown input is too large: ${markdownInputBytes} bytes. Set maxInputBytes to at least ${markdownInputBytes} or pass smaller Markdown.`,
  );
}
