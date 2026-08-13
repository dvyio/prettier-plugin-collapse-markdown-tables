/**
 * @fileoverview Makes inline-code pipes unambiguous before Prettier parses Markdown tables.
 */

import type { NormalizeMarkdownTablesOptions } from '../normalizeMarkdownTables.js';
import type {
  ColumnCount,
  ContainerKey,
  LineIndex,
  MarkdownOffset,
} from './types.js';

import {
  getLineStartOffsets,
  getNormalizationRange,
  isCompatibleContainerKey,
  isMarkdownEscapedCharacter,
  joinMarkdownLines,
  ROOT_CONTAINER_KEY,
  splitMarkdownLines,
  stripRootByteOrderMark,
  tableBlockIntersectsRange,
  toLineIndex,
  toMarkdownOffset,
} from './lineUtils.js';
import {
  findProtectedLines,
  parseContainerLine,
  parsePrettierIgnoreDirective,
} from './protectedRegions.js';
import {
  getValidDelimiterColumnCount,
  mayContainMarkdownTableCandidate,
  scanCodeSpans,
} from './tableRows.js';

/** Markdown plus the original offsets where the pre-parser inserted backslashes. */
type EscapedMarkdown = {
  readonly insertedBackslashOffsets: ReadonlyArray<MarkdownOffset>;
  readonly markdown: string;
};

type PrettierParsedTableRow = {
  readonly balanced: boolean;
  readonly cells: ReadonlyArray<string>;
  readonly codeSpanPipePositions: ReadonlyArray<MarkdownOffset>;
  readonly containerKey: ContainerKey;
  readonly content: string;
  readonly contentStart: MarkdownOffset;
  readonly lineIndex: LineIndex;
  readonly rawPipePositions: ReadonlyArray<MarkdownOffset>;
  readonly startsListItem: boolean;
};

type PrettierTableCandidate = {
  readonly delimiterColumnCount: ColumnCount;
  readonly end: LineIndex;
  readonly rows: ReadonlyArray<PrettierParsedTableRow>;
  readonly start: LineIndex;
};

type PrettierTableBlock = {
  readonly columnCount: ColumnCount;
  readonly end: LineIndex;
  readonly rows: ReadonlyArray<PrettierParsedTableRow>;
  readonly start: LineIndex;
};

/**
 * Repairs delimiter rows that Prettier widened only because it split closed
 * inline-code spans at raw pipes.
 */
export function repairPrettierWidenedTableDelimiters(
  markdown: string,
  options: NormalizeMarkdownTablesOptions,
): string {
  if (!markdown.includes('`') || !mayContainMarkdownTableCandidate(markdown)) {
    return markdown;
  }

  const markdownLines = splitMarkdownLines(markdown);
  const lines = markdownLines.lines;
  const repairedLines = [...lines];
  const markdownLength = toMarkdownOffset(markdown.length);
  const normalizationRange = getNormalizationRange(markdownLength, options);
  const lineStartOffsets = getLineStartOffsets(
    lines,
    markdownLines.lineSeparators,
  );
  const protectedLines = findProtectedLines(lines, options);
  let changed = false;

  for (let index = 0; index < lines.length; index++) {
    const tableCandidate = findPrettierTableCandidate(
      lines,
      toLineIndex(index),
      protectedLines,
    );

    if (tableCandidate === undefined) {
      continue;
    }

    if (
      isRecoverableWidenedTableDelimiter(tableCandidate) &&
      tableBlockIntersectsRange(
        tableCandidate.start,
        tableCandidate.rows.length,
        lines,
        lineStartOffsets,
        markdownLength,
        normalizationRange,
      )
    ) {
      const header = tableCandidate.rows[0];
      const separator = tableCandidate.rows[1];
      const separatorLine = repairedLines[separator?.lineIndex ?? -1];

      if (
        header !== undefined &&
        separator !== undefined &&
        separatorLine !== undefined
      ) {
        const repairedLine = repairWidenedDelimiterLine(
          separatorLine,
          separator,
          header.cells.length,
        );

        if (repairedLine !== separatorLine) {
          repairedLines[separator.lineIndex] = repairedLine;
          changed = true;
        }
      }
    }

    index = tableCandidate.end;
  }

  if (!changed) {
    return markdown;
  }

  return joinMarkdownLines(repairedLines, markdownLines.lineSeparators);
}

/**
 * Escapes pipes inside closed code spans without otherwise rewriting table rows.
 */
export function escapeMarkdownTableCodeSpanPipes(
  markdown: string,
  options: NormalizeMarkdownTablesOptions,
): EscapedMarkdown {
  if (!markdown.includes('`') || !mayContainMarkdownTableCandidate(markdown)) {
    return { insertedBackslashOffsets: [], markdown };
  }

  const markdownLines = splitMarkdownLines(markdown);
  const lines = markdownLines.lines;
  const markdownLength = toMarkdownOffset(markdown.length);
  const normalizationRange = getNormalizationRange(markdownLength, options);
  const lineStartOffsets = getLineStartOffsets(
    lines,
    markdownLines.lineSeparators,
  );
  const protectedLines = findProtectedLines(lines, options);
  const insertedBackslashOffsets: Array<MarkdownOffset> = [];

  for (let index = 0; index < lines.length; index++) {
    const tableBlock = findPrettierTableBlock(
      lines,
      toLineIndex(index),
      protectedLines,
    );

    if (tableBlock === undefined) {
      continue;
    }

    if (
      tableBlockIntersectsRange(
        tableBlock.start,
        tableBlock.rows.length,
        lines,
        lineStartOffsets,
        markdownLength,
        normalizationRange,
      )
    ) {
      collectTableBackslashInsertions(
        tableBlock,
        lineStartOffsets,
        insertedBackslashOffsets,
      );
    }

    index = tableBlock.end;
  }

  return {
    insertedBackslashOffsets,
    markdown: insertBackslashes(markdown, insertedBackslashOffsets),
  };
}

function findPrettierTableBlock(
  lines: ReadonlyArray<string>,
  start: LineIndex,
  protectedLines: ReadonlyArray<boolean>,
): PrettierTableBlock | undefined {
  const tableCandidate = findPrettierTableCandidate(
    lines,
    start,
    protectedLines,
  );
  const header = tableCandidate?.rows[0];

  if (
    tableCandidate === undefined ||
    header?.cells.length !== tableCandidate.delimiterColumnCount
  ) {
    return undefined;
  }

  return {
    columnCount: tableCandidate.delimiterColumnCount,
    end: tableCandidate.end,
    rows: tableCandidate.rows,
    start: tableCandidate.start,
  };
}

function findPrettierTableCandidate(
  lines: ReadonlyArray<string>,
  start: LineIndex,
  protectedLines: ReadonlyArray<boolean>,
): PrettierTableCandidate | undefined {
  if (
    start + 1 >= lines.length ||
    protectedLines[start] === true ||
    protectedLines[start + 1] === true
  ) {
    return undefined;
  }

  const header = parsePrettierTableRow(lines[start] ?? '', start);
  const separator = parsePrettierTableRow(lines[start + 1] ?? '', start + 1);

  if (
    header === undefined ||
    separator === undefined ||
    isPrettierIgnoredTableStart(lines, start, header) ||
    separator.startsListItem ||
    !hasCompatiblePrettierTableContainer(separator, header) ||
    !header.balanced ||
    !separator.balanced
  ) {
    return undefined;
  }

  const delimiterColumnCount = getValidDelimiterColumnCount(separator.cells);

  if (delimiterColumnCount === undefined) {
    return undefined;
  }

  const rows = [header, separator];
  let end = start + 1;

  for (let index = start + 2; index < lines.length; index++) {
    if (protectedLines[index] === true) {
      break;
    }

    const row = parsePrettierTableRow(lines[index] ?? '', index);

    if (
      row === undefined ||
      row.startsListItem ||
      !hasCompatiblePrettierTableContainer(row, header)
    ) {
      break;
    }

    rows.push(row);
    end = index;
  }

  return {
    delimiterColumnCount,
    end: toLineIndex(end),
    rows,
    start,
  };
}

function isPrettierIgnoredTableStart(
  lines: ReadonlyArray<string>,
  start: LineIndex,
  header: PrettierParsedTableRow,
): boolean {
  const blankContainerKeys: Array<ContainerKey> = [];

  for (let index = start - 1; index >= 0; index--) {
    const line = lines[index];

    if (line === undefined) {
      return false;
    }

    const strippedLine = stripRootByteOrderMark(line, index);
    const directiveLine = parseContainerLine(strippedLine);

    if (directiveLine.content.trim() === '') {
      blankContainerKeys.push(directiveLine.key);
      continue;
    }

    if (parsePrettierIgnoreDirective(directiveLine.content) !== 'next') {
      return false;
    }

    if (directiveLine.key === ROOT_CONTAINER_KEY) {
      return true;
    }

    return (
      isCompatibleContainerKey(header.containerKey, directiveLine.key) &&
      blankContainerKeys.every((blankContainerKey) =>
        isCompatibleContainerKey(blankContainerKey, directiveLine.key),
      )
    );
  }

  return false;
}

function parsePrettierTableRow(
  line: string,
  index: number,
): PrettierParsedTableRow | undefined {
  const strippedLine = stripRootByteOrderMark(line, index);
  const byteOrderMarkLength = line.length - strippedLine.length;
  const containerLine = parseContainerLine(strippedLine);
  const leadingWhitespace = /^[ \t]*/.exec(containerLine.content)?.[0] ?? '';
  const content = containerLine.content.slice(leadingWhitespace.length);
  const contentStart = toMarkdownOffset(
    byteOrderMarkLength + containerLine.contentStart + leadingWhitespace.length,
  );

  if (content === '' || isTableInterruptingBlockStart(content)) {
    return undefined;
  }

  const codeSpans = scanCodeSpans(content);
  const lastNonWhitespaceIndex = findLastNonWhitespaceIndex(content);
  const rawPipePositions: Array<MarkdownOffset> = [];
  const codeSpanPipePositions: Array<MarkdownOffset> = [];
  const separatorPositions: Array<MarkdownOffset> = [];
  let codeSpanIndex = 0;

  for (let contentIndex = 0; contentIndex < content.length; contentIndex++) {
    if (content[contentIndex] !== '|') {
      continue;
    }

    rawPipePositions.push(toMarkdownOffset(contentIndex));

    while (codeSpanIndex < codeSpans.spans.length) {
      const codeSpan = codeSpans.spans[codeSpanIndex];

      if (codeSpan === undefined || codeSpan.end > contentIndex) {
        break;
      }

      codeSpanIndex++;
    }

    const codeSpan = codeSpans.spans[codeSpanIndex];
    const isInCodeSpan =
      codeSpan !== undefined &&
      contentIndex >= codeSpan.start &&
      contentIndex < codeSpan.end;
    const isEscaped = isMarkdownEscapedCharacter(content, contentIndex);

    if (isInCodeSpan && !isEscaped) {
      codeSpanPipePositions.push(toMarkdownOffset(contentIndex));
    }

    if (!isInCodeSpan && !isEscaped) {
      separatorPositions.push(toMarkdownOffset(contentIndex));
    }
  }

  const leadingOuterPipe = separatorPositions[0] === 0;
  const leadingOuterPipeOffset = leadingOuterPipe ? 0 : -1;
  const hasRawPipeAfterLeadingOuter = rawPipePositions.some(
    (pipePosition) => pipePosition > leadingOuterPipeOffset,
  );

  if (!hasRawPipeAfterLeadingOuter) {
    return undefined;
  }

  const trailingOuterPipe = separatorPositions.some(
    (pipePosition) => pipePosition === lastNonWhitespaceIndex,
  );
  const internalSeparatorPositions = separatorPositions.filter(
    (pipePosition) =>
      (!leadingOuterPipe || pipePosition !== 0) &&
      (!trailingOuterPipe || pipePosition !== lastNonWhitespaceIndex),
  );
  const contentEnd = trailingOuterPipe
    ? lastNonWhitespaceIndex
    : content.length;
  const cellStart = leadingOuterPipe ? 1 : 0;
  const cells = splitPrettierTableCells(
    content,
    cellStart,
    contentEnd,
    internalSeparatorPositions,
  );
  return {
    balanced: !codeSpans.hasUnclosedCodeSpan,
    cells,
    codeSpanPipePositions,
    containerKey: containerLine.key,
    content,
    contentStart,
    lineIndex: toLineIndex(index),
    rawPipePositions,
    startsListItem: containerLine.startsListItem,
  };
}

function isTableInterruptingBlockStart(content: string): boolean {
  return /^#{1,6}(?:[ \t]+|$)/u.test(content);
}

function splitPrettierTableCells(
  content: string,
  start: number,
  end: number,
  separatorPositions: ReadonlyArray<MarkdownOffset>,
): ReadonlyArray<string> {
  const cells: Array<string> = [];
  let cellStart = start;

  for (const separatorPosition of separatorPositions) {
    cells.push(content.slice(cellStart, separatorPosition));
    cellStart = separatorPosition + 1;
  }

  cells.push(content.slice(cellStart, end));

  return cells;
}

function hasCompatiblePrettierTableContainer(
  row: PrettierParsedTableRow,
  header: PrettierParsedTableRow,
): boolean {
  return isCompatibleContainerKey(row.containerKey, header.containerKey);
}

function collectTableBackslashInsertions(
  tableBlock: PrettierTableBlock,
  lineStartOffsets: ReadonlyArray<MarkdownOffset>,
  insertionOffsets: Array<MarkdownOffset>,
): void {
  for (const row of tableBlock.rows) {
    if (!row.balanced || row.cells.length > tableBlock.columnCount) {
      continue;
    }

    const lineStartOffset = lineStartOffsets[row.lineIndex];

    if (lineStartOffset === undefined) {
      continue;
    }

    collectRowBackslashInsertions(row, lineStartOffset, insertionOffsets);
  }
}

function collectRowBackslashInsertions(
  row: PrettierParsedTableRow,
  lineStartOffset: MarkdownOffset,
  insertionOffsets: Array<MarkdownOffset>,
): void {
  for (const pipePosition of row.codeSpanPipePositions) {
    insertionOffsets.push(
      toMarkdownOffset(lineStartOffset + row.contentStart + pipePosition),
    );
  }
}

function isRecoverableWidenedTableDelimiter(
  tableCandidate: PrettierTableCandidate,
): boolean {
  const header = tableCandidate.rows[0];

  if (
    header === undefined ||
    tableCandidate.rows.length < 3 ||
    header.cells.length >= tableCandidate.delimiterColumnCount
  ) {
    return false;
  }

  const extraColumns =
    tableCandidate.delimiterColumnCount - header.cells.length;
  let foundExplainingCodePipes = false;

  for (let index = 0; index < tableCandidate.rows.length; index++) {
    if (index === 1) {
      continue;
    }

    const row = tableCandidate.rows[index];

    if (
      row === undefined ||
      !row.balanced ||
      row.cells.length !== header.cells.length ||
      row.codeSpanPipePositions.length > extraColumns
    ) {
      return false;
    }

    if (row.codeSpanPipePositions.length === extraColumns) {
      foundExplainingCodePipes = true;
    }
  }

  return foundExplainingCodePipes;
}

function repairWidenedDelimiterLine(
  line: string,
  separator: PrettierParsedTableRow,
  intendedColumnCount: number,
): string {
  const lastNonWhitespaceIndex = findLastNonWhitespaceIndex(separator.content);
  const leadingOuterPipe = separator.rawPipePositions[0] === 0;
  const trailingOuterPipe = separator.rawPipePositions.some(
    (pipePosition) => pipePosition === lastNonWhitespaceIndex,
  );
  const internalSeparatorPositions = separator.rawPipePositions.filter(
    (pipePosition) =>
      (!leadingOuterPipe || pipePosition !== 0) &&
      (!trailingOuterPipe || pipePosition !== lastNonWhitespaceIndex),
  );
  const removeStart = internalSeparatorPositions[intendedColumnCount - 1];
  const removeEnd = trailingOuterPipe
    ? lastNonWhitespaceIndex
    : lastNonWhitespaceIndex + 1;

  if (removeStart === undefined || removeStart >= removeEnd) {
    return line;
  }

  const lineRemoveStart = separator.contentStart + removeStart;
  const lineRemoveEnd = separator.contentStart + removeEnd;
  const replacement = ' '.repeat(lineRemoveEnd - lineRemoveStart);

  return `${line.slice(0, lineRemoveStart)}${replacement}${line.slice(
    lineRemoveEnd,
  )}`;
}

function insertBackslashes(
  markdown: string,
  insertionOffsets: ReadonlyArray<MarkdownOffset>,
): string {
  if (insertionOffsets.length === 0) {
    return markdown;
  }

  const parts: Array<string> = [];
  let copiedUntil = 0;

  for (const insertionOffset of insertionOffsets) {
    parts.push(markdown.slice(copiedUntil, insertionOffset), '\\');
    copiedUntil = insertionOffset;
  }

  parts.push(markdown.slice(copiedUntil));

  return parts.join('');
}

function findLastNonWhitespaceIndex(value: string): number {
  for (let index = value.length - 1; index >= 0; index--) {
    const char = value[index];

    if (char !== ' ' && char !== '\t' && char !== '\r') {
      return index;
    }
  }

  return -1;
}
