/**
 * @fileoverview Shares private normalizer types across focused modules.
 */

import type { ParsedMarkdownTableRow, TableRowPrefix } from './publicTypes.js';

export type { TableRowPrefix } from './publicTypes.js';

declare const columnCountBrand: unique symbol;
declare const containerKeyBrand: unique symbol;
declare const lineIndexBrand: unique symbol;
declare const markdownColumnBrand: unique symbol;
declare const markdownOffsetBrand: unique symbol;
declare const normalizedOffsetBrand: unique symbol;
declare const scanTextOffsetBrand: unique symbol;

/** Checked table column count. It is always a positive whole number. */
export type ColumnCount = {
  readonly [columnCountBrand]: 'ColumnCount';
} & number;

/** Slash-joined Markdown container parts such as `blockquote/list`. */
export type ContainerKey = {
  readonly [containerKeyBrand]: 'ContainerKey';
} & string;

/** Checked zero-based line index. */
export type LineIndex = {
  readonly [lineIndexBrand]: 'LineIndex';
} & number;

/** Checked Markdown column count after tabs expand to four-column stops. */
export type MarkdownColumn = {
  readonly [markdownColumnBrand]: 'MarkdownColumn';
} & number;

/** Checked offset in original Markdown text. */
export type MarkdownOffset = {
  readonly [markdownOffsetBrand]: 'MarkdownOffset';
} & number;

/** Checked offset in normalized Markdown text. */
export type NormalizedOffset = {
  readonly [normalizedOffsetBrand]: 'NormalizedOffset';
} & number;

/** Checked offset in joined scan text used by MDX scanners. */
export type ScanTextOffset = {
  readonly [scanTextOffsetBrand]: 'ScanTextOffset';
} & number;

/** Raw normalizer options before boundary checks narrow public input. */
export type UncheckedNormalizeMarkdownTablesOptions = {
  readonly enableMdxEsm?: unknown;
  readonly enableMdxJsx?: unknown;
  readonly markdownTableStyle?: unknown;
  readonly maxInputBytes?: number | undefined;
  readonly rangeEnd?: unknown;
  readonly rangeStart?: unknown;
};

/** Cell text and delimiter offsets from one table row scan. */
export type CellScanResult = {
  readonly cells: ReadonlyArray<string>;
  readonly delimiterPositions: ReadonlyArray<MarkdownOffset>;
};

/** Inclusive start and exclusive end offsets for a closed code span. */
export type CodeSpanRange = {
  readonly end: MarkdownOffset;
  readonly start: MarkdownOffset;
};

/** One backtick delimiter run and whether Markdown escaping protects it. */
export type CodeSpanDelimiterRun = {
  readonly end: MarkdownOffset;
  readonly isEscaped: boolean;
  readonly length: number;
  readonly start: MarkdownOffset;
};

/** Closed code spans plus a flag for unmatched opening delimiters. */
export type CodeSpanScanResult = {
  readonly hasUnclosedCodeSpan: boolean;
  readonly spans: ReadonlyArray<CodeSpanRange>;
};

/** Tracks an open code span while broken table cells are being rejoined. */
export type CodeSpanRepairState = {
  readonly openDelimiterLength: number | undefined;
  readonly trailingBackslashCount: number;
};

/** Line separator styles preserved when split Markdown is joined again. */
export type LineSeparator = '\n' | '\r' | '\r\n';

/** Inclusive line range. */
export type LineRange = {
  readonly end: LineIndex;
  readonly start: LineIndex;
};

/** Markdown lines paired with the separator that followed each original line. */
export type MarkdownLines = {
  readonly lines: ReadonlyArray<string>;
  readonly lineSeparators: ReadonlyArray<'' | LineSeparator>;
};

/** Quote characters that can keep JavaScript-like scanner text protected. */
export type JavaScriptQuote = '"' | '`' | "'";

/** JavaScript delimiter state carried across MDX ESM lines. */
export type JavaScriptScanState = {
  readonly braceDepth: number;
  readonly bracketDepth: number;
  readonly canStartRegex: boolean;
  readonly isBlockComment: boolean;
  readonly parenDepth: number;
  readonly quote: JavaScriptQuote | undefined;
};

/** JavaScript-like delimiter state carried across MDX flow expression lines. */
export type MdxFlowExpressionScanState = {
  readonly braceDepth: number;
  readonly canStartRegex: boolean;
  readonly isBlockComment: boolean;
  readonly quote: JavaScriptQuote | undefined;
};

/** Result for one scanned MDX flow expression line. */
export type MdxFlowExpressionLineScanResult = {
  readonly isClosed: boolean;
  readonly state: MdxFlowExpressionScanState;
};

/** CommonMark HTML block start rules that close by marker or by blank line. */
export type HtmlBlockStart =
  | {
      readonly endMarker: '?>' | ']]>' | '>';
      readonly type: 'cdata' | 'declaration' | 'processing-instruction';
    }
  | {
      readonly type: 'blank-line';
    };

/** Quote characters accepted around HTML attributes. */
export type HtmlAttributeQuote = '"' | "'";

/** Parsed MDX JSX tag name, kind, and end offset in joined scan text. */
export type MdxJsxTag = {
  readonly endOffset: ScanTextOffset;
  readonly name: string;
  readonly type: 'closing' | 'opening' | 'self-closing';
};

/** Quote characters accepted inside MDX JSX tags. */
export type MdxJsxQuote = '"' | '`' | "'";

/** Joined MDX JSX scan text with offsets back to original line indexes. */
export type MdxJsxScanText = {
  readonly lines: ReadonlyArray<string>;
  readonly lineStartOffsets: ReadonlyArray<ScanTextOffset | undefined>;
  readonly text: string;
};

/** Markdown indentation measured in both columns and source offsets. */
export type MarkdownIndent = {
  readonly column: MarkdownColumn;
  readonly offset: MarkdownOffset;
};

/** List marker indentation and the content column that keeps later lines inside the item. */
export type ListItemStart = {
  readonly contentIndent: MarkdownColumn;
  readonly markerIndent: MarkdownColumn;
};

/** Result of repairing an over-split table row back to the expected column count. */
export type RepairBrokenCellsResult =
  | {
      readonly cells: ReadonlyArray<string>;
      readonly status: 'repaired';
    }
  | {
      readonly status: 'failed';
    };

/** Result of repairing the final table cell from all remaining fragments. */
export type RepairFinalCellFragmentsResult =
  | {
      readonly cell: string;
      readonly status: 'repaired';
      readonly usedRepairEvidence: boolean;
    }
  | {
      readonly status: 'failed';
    };

/** Evidence that a fragment boundary was cell text instead of a real table delimiter. */
export type RepairBoundaryEvidence = 'escaped-pipe' | 'open-code-span';

/** Rendered row state used to prove normalization did not change table meaning. */
export type NormalizedTableRow =
  | {
      readonly cells: ReadonlyArray<string>;
      readonly line: string;
      readonly status: 'normalized' | 'repaired';
    }
  | {
      readonly line: string;
      readonly status: 'preserved' | 'separator';
    };

/** Markdown fence marker and delimiter length. */
export type FenceStart = {
  readonly char: '`' | '~';
  readonly length: number;
};

/** Private parsed table row with the branded prefix required by renderer code. */
export type ParsedTableRow = {
  readonly prefix: TableRowPrefix;
} & ParsedMarkdownTableRow;

/** Safe table block with parsed rows and inclusive source line bounds. */
export type MarkdownTableBlock = {
  readonly end: LineIndex;
  readonly lines: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ParsedTableRow>;
  readonly start: LineIndex;
};

/** Markdown container shape used to compare table row prefixes. */
export type TableRowPrefixShape =
  | {
      readonly markers: string;
      readonly type: 'blockquote';
    }
  | {
      readonly type: 'indented';
    }
  | {
      readonly type: 'root';
    };

/** Prettier ignore directive names that protect table rows. */
export type PrettierIgnoreDirective = 'end' | 'next' | 'start';

/** Markdown line after blockquote, list, and indented-code containers are stripped. */
export type ContainerLine = {
  readonly content: string;
  readonly key: ContainerKey;
};

/** Footnote definition content column used to detect continuation lines. */
export type FootnoteDefinitionStart = {
  readonly contentIndent: MarkdownColumn;
};

/** Checked half-open Markdown range requested by callers or Prettier. */
export type NormalizationRange = {
  readonly end: MarkdownOffset;
  readonly start: MarkdownOffset;
};
