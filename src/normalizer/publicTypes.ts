/**
 * @fileoverview Shares Markdown table types used by the public helper API.
 */

/** Table style choices accepted by the Prettier plugin and standalone normalizer. */
export const MARKDOWN_TABLE_STYLE_OPTIONS = [
  {
    description: 'Use one space inside each table cell.',
    value: 'spaced',
  },
  {
    description: 'Remove table cell padding.',
    value: 'compact',
  },
  {
    description: 'Keep Prettier aligned tables.',
    value: 'prettier',
  },
] as const;

/** Table styles accepted by the Prettier plugin and standalone normalizer. */
export type MarkdownTableStyle =
  (typeof MARKDOWN_TABLE_STYLE_OPTIONS)[number]['value'];

/** Table style used when callers do not choose one. */
export const DEFAULT_MARKDOWN_TABLE_STYLE: MarkdownTableStyle =
  MARKDOWN_TABLE_STYLE_OPTIONS[0].value;

declare const tableRowPrefixBrand: unique symbol;

/** Leading spaces, tabs, and blockquote markers accepted before a pipe-started table row. */
export type TableRowPrefix = {
  readonly [tableRowPrefixBrand]: 'TableRowPrefix';
} & string;

/** Parsed row data used to normalize only safe Markdown table rows. */
export type ParsedMarkdownTableRow = {
  /** Whether the row has no unclosed inline code span. */
  readonly balanced: boolean;
  /** Cell text split at safe delimiters. Escaped pipes and pipes inside closed code spans stay in the cell. */
  readonly cells: ReadonlyArray<string>;
  /** Row text from the first pipe onward, without the prefix. */
  readonly content: string;
  /** Offsets in `content` for delimiter pipes used by `cells`. */
  readonly delimiterPositions: ReadonlyArray<number>;
  /** Cell fragments split at every unescaped pipe, so repair code can check ambiguous rows. */
  readonly fragments: ReadonlyArray<string>;
  /** Whether the last non-whitespace character in `content` is a pipe. */
  readonly hasTrailingPipe: boolean;
  /** Leading Markdown text before the first pipe. */
  readonly prefix: TableRowPrefix;
  /** Offsets in `content` for delimiter pipes used by `fragments`. */
  readonly rawDelimiterPositions: ReadonlyArray<number>;
};
