/**
 * @fileoverview Finds Markdown lines that table normalization must not touch.
 */

import type {
  ContainerKey,
  ContainerLine,
  FenceStart,
  FootnoteDefinitionStart,
  ListItemStart,
  MarkdownColumn,
  MarkdownOffset,
  PrettierIgnoreDirective,
  UncheckedNormalizeMarkdownTablesOptions,
} from './types.js';

import {
  findHtmlBlockEnd,
  findHtmlCommentEnd,
  findRawHtmlEnd,
} from './htmlBlocks.js';
import {
  countMarkdownColumns,
  countRun,
  findCompatibleContainerEnd,
  isCompatibleContainerKey,
  ROOT_CONTAINER_KEY,
  scanMarkdownIndent,
  stripRootByteOrderMark,
  toContainerKey,
  toLineIndex,
  toMarkdownColumn,
} from './lineUtils.js';
import {
  findMdxEsmEnd,
  findMdxFlowExpressionEnd,
  isMdxEsmStart,
  isMdxFlowExpressionStart,
} from './mdxEsm.js';
import { findMdxJsxEnd, isMdxJsxStartCandidate } from './mdxJsx.js';
import { findMarkdownTableBlock, parsePipedRow } from './tableRows.js';

const MARKDOWN_TAB_WIDTH = 4;
const MARKDOWN_TABLE_FENCE_LANGUAGES = [
  'gfm',
  'markdown',
  'md',
  'mdx',
] as const;

type ProtectedLineContext = {
  readonly containerContents: ReadonlyArray<string>;
  readonly containerKeys: ReadonlyArray<ContainerKey>;
  readonly containerLines: ReadonlyArray<ContainerLine>;
  readonly enabledMarkdownFenceDelimiterLines: ReadonlyArray<boolean>;
  readonly enabledMarkdownFenceEndLines: ReadonlyArray<number | undefined>;
  readonly footnoteContinuationTableRows: ReadonlyArray<boolean>;
  readonly lines: ReadonlyArray<string>;
  readonly listContinuationTableRows: ReadonlyArray<boolean>;
  readonly options: UncheckedNormalizeMarkdownTablesOptions;
  readonly scanContents: ReadonlyArray<string>;
  readonly scanDetectionLines: ReadonlyArray<string>;
  readonly scanKeys: ReadonlyArray<ContainerKey>;
};

type ProtectedLineDetector = (
  context: ProtectedLineContext,
  index: number,
) => ProtectedLineDetectorResult | undefined;

type ProtectedLineDetectorResult =
  | {
      readonly kind: 'range';
      readonly range: ProtectedLineRange;
    }
  | {
      readonly kind: 'skip';
    };

type ProtectedLineRange = {
  readonly end: number;
  readonly start: number;
};

type EnabledMarkdownFenceLines = {
  readonly delimiterLines: ReadonlyArray<boolean>;
  readonly endLines: ReadonlyArray<number | undefined>;
  readonly scanContents: ReadonlyArray<string>;
  readonly scanDetectionLines: ReadonlyArray<string>;
  readonly scanKeys: ReadonlyArray<ContainerKey>;
};

const SKIP_PROTECTED_LINE_DETECTION: ProtectedLineDetectorResult = {
  kind: 'skip',
};

const ORDERED_PROTECTED_LINE_DETECTORS: ReadonlyArray<ProtectedLineDetector> = [
  findFenceProtectedRange,
  findIndentedCodeProtectedRange,
  findMdxEsmProtectedRange,
  skipPrettierIgnoreDirective,
  findMdxFlowExpressionProtectedRange,
  findHtmlCommentProtectedRange,
  findRawHtmlProtectedRange,
  findMdxJsxProtectedRange,
  findHtmlBlockProtectedRange,
];

/**
 * Marks Markdown lines that must stay untouched, including front matter, code, HTML, MDX, and ignored tables.
 */
export function findProtectedLines(
  lines: ReadonlyArray<string>,
  options: UncheckedNormalizeMarkdownTablesOptions,
): ReadonlyArray<boolean> {
  const context = createProtectedLineContext(lines, options);
  const ranges = findProtectedLineRanges(context);

  return markProtectedRanges(lines.length, ranges);
}

function createProtectedLineContext(
  lines: ReadonlyArray<string>,
  options: UncheckedNormalizeMarkdownTablesOptions,
): ProtectedLineContext {
  const detectionLines = lines.map(stripRootByteOrderMark);
  const containerLines = detectionLines.map(parseContainerLine);
  const containerContents = containerLines.map(({ content }) => content);
  const containerKeys = containerLines.map(({ key }) => key);
  const enabledMarkdownFenceLines = findEnabledMarkdownFenceLines(
    lines,
    containerContents,
    containerKeys,
    options,
  );
  const continuationContainerLines = detectionLines.map(
    parseContinuationContainerLine,
  );
  const listContinuationTableRows = findListContinuationTableRows(
    continuationContainerLines,
  );
  const footnoteContinuationTableRows = findFootnoteContinuationTableRows(
    continuationContainerLines,
  );

  return {
    containerContents,
    containerKeys,
    containerLines,
    enabledMarkdownFenceDelimiterLines:
      enabledMarkdownFenceLines.delimiterLines,
    enabledMarkdownFenceEndLines: enabledMarkdownFenceLines.endLines,
    footnoteContinuationTableRows,
    lines,
    listContinuationTableRows,
    options,
    scanContents: enabledMarkdownFenceLines.scanContents,
    scanDetectionLines: enabledMarkdownFenceLines.scanDetectionLines,
    scanKeys: enabledMarkdownFenceLines.scanKeys,
  };
}

function findEnabledMarkdownFenceLines(
  lines: ReadonlyArray<string>,
  containerContents: ReadonlyArray<string>,
  containerKeys: ReadonlyArray<ContainerKey>,
  options: UncheckedNormalizeMarkdownTablesOptions,
): EnabledMarkdownFenceLines {
  const delimiterLines = Array.from({ length: lines.length }, () => false);
  const endLines: Array<number | undefined> = Array.from(
    { length: lines.length },
    () => undefined,
  );
  const scanContents = [...containerContents];
  const scanDetectionLines = lines.map(stripRootByteOrderMark);
  const scanKeys = [...containerKeys];

  if (options.markdownTableFencedCode !== 'markdown') {
    return {
      delimiterLines,
      endLines,
      scanContents,
      scanDetectionLines,
      scanKeys,
    };
  }

  for (let index = 0; index < lines.length; index++) {
    if (delimiterLines[index] === true) {
      continue;
    }

    const line = containerContents[index];

    if (line === undefined) {
      continue;
    }

    const fence = parseFenceStart(line);

    if (fence === undefined || !isMarkdownTableFenceStart(line, fence)) {
      continue;
    }

    const end = findFenceEnd(
      lines,
      containerContents,
      containerKeys,
      index,
      fence,
    );

    delimiterLines[index] = true;
    delimiterLines[end] = true;

    for (let contentIndex = index + 1; contentIndex < end; contentIndex++) {
      const contentLine = readEnabledMarkdownFenceContentLine(
        lines,
        contentIndex,
        fence,
        containerKeys[index] ?? ROOT_CONTAINER_KEY,
      );
      const scanLine = parseContainerLine(contentLine);

      endLines[contentIndex] = end;
      scanContents[contentIndex] = scanLine.content;
      scanDetectionLines[contentIndex] = contentLine;
      scanKeys[contentIndex] = scanLine.key;
    }
  }

  return {
    delimiterLines,
    endLines,
    scanContents,
    scanDetectionLines,
    scanKeys,
  };
}

function readEnabledMarkdownFenceContentLine(
  lines: ReadonlyArray<string>,
  index: number,
  fence: FenceStart,
  fenceContainerKey: ContainerKey,
): string {
  const line =
    fenceContainerKey === ROOT_CONTAINER_KEY
      ? (lines[index] ?? '')
      : stripContainerPrefix(lines[index] ?? '', fenceContainerKey);

  return line.slice(countRemovableFenceIndent(line, fence.offset));
}

function stripContainerPrefix(line: string, key: ContainerKey): string {
  let offset = 0;

  for (const part of key.split('/')) {
    const end = findContainerPartEnd(line, offset, part);

    if (end === undefined) {
      return line.slice(offset);
    }

    offset = end;
  }

  return line.slice(offset);
}

function findContainerPartEnd(
  line: string,
  offset: number,
  part: string,
): number | undefined {
  if (part === 'blockquote') {
    return parseContainerBlockquoteEnd(line, offset);
  }

  if (part === 'list') {
    return parseContainerListItemEnd(line, offset);
  }

  if (part === 'indent') {
    return parseContainerIndentEnd(line, offset);
  }

  return undefined;
}

function findProtectedLineRanges(
  context: ProtectedLineContext,
): ReadonlyArray<ProtectedLineRange> {
  const ranges: Array<ProtectedLineRange> = [
    ...findFrontMatterProtectedRanges(context),
  ];
  const protectedLines = markProtectedRanges(context.lines.length, ranges);
  const structuralRanges = findStructuralProtectedRanges(
    context,
    protectedLines,
  );

  ranges.push(...structuralRanges);
  applyProtectedRanges(protectedLines, structuralRanges);
  ranges.push(...findPrettierIgnoredRanges(context, protectedLines));

  return ranges;
}

function findFrontMatterProtectedRanges(
  context: ProtectedLineContext,
): ReadonlyArray<ProtectedLineRange> {
  const frontMatterEnd = findFrontMatterEnd(context.lines);

  if (frontMatterEnd === undefined) {
    return [];
  }

  return [createProtectedLineRange(0, frontMatterEnd)];
}

function findStructuralProtectedRanges(
  context: ProtectedLineContext,
  protectedLines: ReadonlyArray<boolean>,
): ReadonlyArray<ProtectedLineRange> {
  const ranges: Array<ProtectedLineRange> = [];

  for (let index = 0; index < context.lines.length; index++) {
    if (protectedLines[index] === true) {
      continue;
    }

    const result = findStructuralProtectedRange(context, index);

    if (result === undefined) {
      continue;
    }

    if (result.kind === 'skip') {
      continue;
    }

    const range = constrainProtectedRangeToEnabledMarkdownFence(
      context,
      index,
      result.range,
    );

    ranges.push(range);
    index = range.end;
  }

  return ranges;
}

function constrainProtectedRangeToEnabledMarkdownFence(
  context: ProtectedLineContext,
  index: number,
  range: ProtectedLineRange,
): ProtectedLineRange {
  const enabledFenceEnd = context.enabledMarkdownFenceEndLines[index];

  if (enabledFenceEnd === undefined || range.end < enabledFenceEnd) {
    return range;
  }

  return createProtectedLineRange(
    range.start,
    Math.max(range.start, enabledFenceEnd - 1),
  );
}

function findStructuralProtectedRange(
  context: ProtectedLineContext,
  index: number,
): ProtectedLineDetectorResult | undefined {
  for (const detector of ORDERED_PROTECTED_LINE_DETECTORS) {
    const result = detector(context, index);

    if (result !== undefined) {
      return result;
    }
  }

  return undefined;
}

function findFenceProtectedRange(
  context: ProtectedLineContext,
  index: number,
): ProtectedLineDetectorResult | undefined {
  if (context.enabledMarkdownFenceDelimiterLines[index] === true) {
    return SKIP_PROTECTED_LINE_DETECTION;
  }

  const line = context.scanContents[index];

  if (line === undefined) {
    return undefined;
  }

  const fence = parseFenceStart(line);

  if (fence === undefined) {
    return undefined;
  }

  if (
    context.options.markdownTableFencedCode === 'markdown' &&
    isMarkdownTableFenceStart(line, fence)
  ) {
    return SKIP_PROTECTED_LINE_DETECTION;
  }

  return createProtectedLineRangeResult(
    index,
    findFenceEnd(
      context.scanDetectionLines,
      context.scanContents,
      context.scanKeys,
      index,
      fence,
    ),
  );
}

function findIndentedCodeProtectedRange(
  context: ProtectedLineContext,
  index: number,
): ProtectedLineDetectorResult | undefined {
  if (context.enabledMarkdownFenceEndLines[index] !== undefined) {
    const content = context.scanContents[index] ?? '';
    const key = context.scanKeys[index] ?? ROOT_CONTAINER_KEY;

    if (!isIndentedCodeLineInsideEnabledMarkdownFence({ content, key })) {
      return undefined;
    }

    return createProtectedLineRangeResult(index, index);
  }

  if (
    !isIndentedCodeLine(
      context.containerLines,
      index,
      context.listContinuationTableRows,
      context.footnoteContinuationTableRows,
    )
  ) {
    return undefined;
  }

  return createProtectedLineRangeResult(index, index);
}

function isIndentedCodeLineInsideEnabledMarkdownFence(
  containerLine: ContainerLine,
): boolean {
  if (containerLine.content.trim() === '') {
    return false;
  }

  if (isIndentedContainerLine(containerLine)) {
    return true;
  }

  return scanMarkdownIndent(containerLine.content).column >= 4;
}

function countRemovableFenceIndent(
  line: string,
  fenceIndentOffset: MarkdownOffset,
): number {
  let offset = 0;

  while (
    offset < fenceIndentOffset &&
    offset < line.length &&
    line[offset] === ' '
  ) {
    offset++;
  }

  return offset;
}

function findMdxEsmProtectedRange(
  context: ProtectedLineContext,
  index: number,
): ProtectedLineDetectorResult | undefined {
  const line = context.scanContents[index];

  if (
    context.options.enableMdxEsm !== true ||
    line === undefined ||
    !isMdxEsmStart(line)
  ) {
    return undefined;
  }

  return createProtectedLineRangeResult(
    index,
    findMdxEsmEnd(context.scanContents, context.scanKeys, index),
  );
}

function skipPrettierIgnoreDirective(
  context: ProtectedLineContext,
  index: number,
): ProtectedLineDetectorResult | undefined {
  if (parsePrettierIgnoreDirective(context.scanContents[index]) === undefined) {
    return undefined;
  }

  return SKIP_PROTECTED_LINE_DETECTION;
}

function findMdxFlowExpressionProtectedRange(
  context: ProtectedLineContext,
  index: number,
): ProtectedLineDetectorResult | undefined {
  const line = context.scanContents[index];

  if (
    context.options.enableMdxEsm !== true ||
    line === undefined ||
    !isMdxFlowExpressionStart(line)
  ) {
    return undefined;
  }

  return createProtectedLineRangeResult(
    index,
    findMdxFlowExpressionEnd(context.scanContents, context.scanKeys, index),
  );
}

function findHtmlCommentProtectedRange(
  context: ProtectedLineContext,
  index: number,
): ProtectedLineDetectorResult | undefined {
  const htmlCommentEnd = findHtmlCommentEnd(
    context.scanContents,
    context.scanKeys,
    index,
  );

  if (htmlCommentEnd === undefined) {
    return undefined;
  }

  return createProtectedLineRangeResult(index, htmlCommentEnd);
}

function findRawHtmlProtectedRange(
  context: ProtectedLineContext,
  index: number,
): ProtectedLineDetectorResult | undefined {
  const rawHtmlEnd = findRawHtmlEnd(
    context.scanContents,
    context.scanKeys,
    index,
  );

  if (rawHtmlEnd === undefined) {
    return undefined;
  }

  return createProtectedLineRangeResult(index, rawHtmlEnd);
}

function findMdxJsxProtectedRange(
  context: ProtectedLineContext,
  index: number,
): ProtectedLineDetectorResult | undefined {
  const line = context.scanContents[index];

  if (
    context.options.enableMdxJsx !== true ||
    line === undefined ||
    !isMdxJsxStartCandidate(line)
  ) {
    return undefined;
  }

  const mdxJsxEnd = findMdxJsxEnd(
    context.scanDetectionLines,
    context.scanContents,
    context.scanKeys,
    toLineIndex(index),
  );

  if (mdxJsxEnd === undefined) {
    return undefined;
  }

  return createProtectedLineRangeResult(index, mdxJsxEnd);
}

function findHtmlBlockProtectedRange(
  context: ProtectedLineContext,
  index: number,
): ProtectedLineDetectorResult | undefined {
  const htmlBlockEnd = findHtmlBlockEnd(
    context.scanContents,
    context.scanKeys,
    index,
  );

  if (htmlBlockEnd === undefined) {
    return undefined;
  }

  return createProtectedLineRangeResult(index, htmlBlockEnd);
}

function createProtectedLineRangeResult(
  start: number,
  end: number,
): ProtectedLineDetectorResult {
  return {
    kind: 'range',
    range: createProtectedLineRange(start, end),
  };
}

function createProtectedLineRange(
  start: number,
  end: number,
): ProtectedLineRange {
  return { end, start };
}

function markProtectedRanges(
  lineCount: number,
  ranges: ReadonlyArray<ProtectedLineRange>,
): Array<boolean> {
  const protectedLines = Array.from({ length: lineCount }, () => false);

  applyProtectedRanges(protectedLines, ranges);

  return protectedLines;
}

function applyProtectedRanges(
  protectedLines: Array<boolean>,
  ranges: ReadonlyArray<ProtectedLineRange>,
): void {
  for (const range of ranges) {
    markLineRange(protectedLines, range.start, range.end);
  }
}

function parseContainerLine(line: string): ContainerLine {
  const parts: Array<string> = [];
  let offset = 0;

  while (offset < line.length) {
    const blockquoteEnd = parseContainerBlockquoteEnd(line, offset);

    if (blockquoteEnd !== undefined) {
      parts.push('blockquote');
      offset = blockquoteEnd;
      continue;
    }

    const listItemEnd = parseContainerListItemEnd(line, offset);

    if (listItemEnd !== undefined) {
      parts.push('list');
      offset = listItemEnd;
      continue;
    }

    const indentEnd = parseContainerIndentEnd(line, offset);

    if (indentEnd !== undefined) {
      parts.push('indent');
      offset = indentEnd;
      break;
    }

    break;
  }

  return {
    content: line.slice(offset),
    key: toContainerKey(parts.join('/')),
  };
}

function parseContinuationContainerLine(line: string): ContainerLine {
  const parts: Array<string> = [];
  let offset = 0;

  while (offset < line.length) {
    const blockquoteEnd = parseContinuationBlockquoteEnd(line, offset);

    if (blockquoteEnd === undefined) {
      break;
    }

    parts.push('blockquote');
    offset = blockquoteEnd;
  }

  return {
    content: line.slice(offset),
    key: toContainerKey(parts.join('/')),
  };
}

function parseContinuationBlockquoteEnd(
  line: string,
  offset: number,
): number | undefined {
  const blockquoteEnd = parseContainerBlockquoteEnd(line, offset);

  if (blockquoteEnd !== undefined) {
    return blockquoteEnd;
  }

  const rest = line.slice(offset);
  const indent = scanMarkdownIndent(rest);

  if (indent.column > 3 || rest[indent.offset] !== '>') {
    return undefined;
  }

  const end = offset + indent.offset + 1;

  if (end < line.length) {
    return undefined;
  }

  return end;
}

function parseContainerBlockquoteEnd(
  line: string,
  offset: number,
): number | undefined {
  const rest = line.slice(offset);
  const indent = scanMarkdownIndent(rest);

  if (indent.column > 3 || rest[indent.offset] !== '>') {
    return undefined;
  }

  let end = offset + indent.offset + 1;

  if (line[end] === ' ' || line[end] === '\t') {
    end++;
  }

  return end;
}

function parseContainerListItemEnd(
  line: string,
  offset: number,
): number | undefined {
  const rest = line.slice(offset);
  const indent = scanMarkdownIndent(rest);

  if (indent.column > 3) {
    return undefined;
  }

  const marker = /^(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$)/.exec(
    rest.slice(indent.offset),
  )?.[0];

  if (marker === undefined) {
    return undefined;
  }

  return offset + indent.offset + marker.length;
}

function parseContainerIndentEnd(
  line: string,
  offset: number,
): number | undefined {
  const rest = line.slice(offset);
  const indent = scanMarkdownIndent(rest);

  if (indent.column < 4) {
    return undefined;
  }

  return offset + findOffsetAfterMarkdownColumns(rest, 4);
}

function findOffsetAfterMarkdownColumns(
  value: string,
  columns: number,
): number {
  let column = 0;

  for (let index = 0; index < value.length; index++) {
    const char = value[index];

    if (char !== ' ' && char !== '\t') {
      return index;
    }

    if (char === '\t') {
      column += MARKDOWN_TAB_WIDTH - (column % MARKDOWN_TAB_WIDTH);
    } else {
      column++;
    }

    if (column >= columns) {
      return index + 1;
    }
  }

  return value.length;
}

function findPrettierIgnoredRanges(
  context: ProtectedLineContext,
  protectedLines: ReadonlyArray<boolean>,
): ReadonlyArray<ProtectedLineRange> {
  const ranges: Array<ProtectedLineRange> = [];
  const ignoredProtectedLines = [...protectedLines];

  for (let index = 0; index < context.lines.length; index++) {
    if (ignoredProtectedLines[index] === true) {
      continue;
    }

    const directive = parsePrettierIgnoreDirective(context.scanContents[index]);
    const containerKey = context.scanKeys[index] ?? ROOT_CONTAINER_KEY;
    const ignoredContainerKey =
      containerKey === ROOT_CONTAINER_KEY ? undefined : containerKey;

    if (directive === 'next') {
      const ignoredRanges = [
        createProtectedLineRange(index, index),
        ...findNextIgnoredTableRanges(
          context,
          ignoredProtectedLines,
          index + 1,
          ignoredContainerKey,
        ),
      ];

      ranges.push(...ignoredRanges);
      applyProtectedRanges(ignoredProtectedLines, ignoredRanges);
      continue;
    }

    if (directive === 'start') {
      const range = constrainProtectedRangeToEnabledMarkdownFence(
        context,
        index,
        createProtectedLineRange(
          index,
          findPrettierIgnoreRangeEnd(
            context.scanContents,
            context.scanKeys,
            ignoredProtectedLines,
            index + 1,
            ignoredContainerKey,
          ),
        ),
      );

      ranges.push(range);
      applyProtectedRanges(ignoredProtectedLines, [range]);
      index = range.end;
    }
  }

  return ranges;
}

function findNextIgnoredTableRanges(
  context: ProtectedLineContext,
  protectedLines: ReadonlyArray<boolean>,
  start: number,
  containerKey: ContainerKey | undefined,
): ReadonlyArray<ProtectedLineRange> {
  const blockStart = findNextNonBlankLine(
    context.scanContents,
    context.scanKeys,
    start,
    containerKey,
  );

  if (blockStart === undefined) {
    return [];
  }

  return findTablesInsideIgnoredBlockRanges(
    context.scanDetectionLines,
    protectedLines,
    blockStart,
    findIgnoredMarkdownBlockEnd(context.scanDetectionLines, blockStart),
  );
}

function findTablesInsideIgnoredBlockRanges(
  lines: ReadonlyArray<string>,
  protectedLines: ReadonlyArray<boolean>,
  start: number,
  end: number,
): ReadonlyArray<ProtectedLineRange> {
  const ranges: Array<ProtectedLineRange> = [];

  for (let index = start; index <= end; index++) {
    if (protectedLines[index] === true || index + 1 > end) {
      continue;
    }

    const tableBlock = findMarkdownTableBlock(lines, toLineIndex(index), {
      end: toLineIndex(end),
      protectedLines,
    });

    if (tableBlock === undefined) {
      continue;
    }

    ranges.push(createProtectedLineRange(index, tableBlock.end));
    index = tableBlock.end;
  }

  return ranges;
}

function parsePrettierIgnoreDirective(
  line: string | undefined,
): PrettierIgnoreDirective | undefined {
  if (line === undefined) {
    return undefined;
  }

  const trimmed = line.trim();

  if (/^<!--\s*prettier-ignore\s*-->$/.test(trimmed)) {
    return 'next';
  }

  if (/^<!--\s*prettier-ignore-start\s*-->$/.test(trimmed)) {
    return 'start';
  }

  if (/^<!--\s*prettier-ignore-end\s*-->$/.test(trimmed)) {
    return 'end';
  }

  if (/^\{\s*\/\*\s*prettier-ignore\s*\*\/\s*\}$/.test(trimmed)) {
    return 'next';
  }

  if (/^\{\s*\/\*\s*prettier-ignore-start\s*\*\/\s*\}$/.test(trimmed)) {
    return 'start';
  }

  if (/^\{\s*\/\*\s*prettier-ignore-end\s*\*\/\s*\}$/.test(trimmed)) {
    return 'end';
  }

  return undefined;
}

function findPrettierIgnoreRangeEnd(
  containerContents: ReadonlyArray<string>,
  containerKeys: ReadonlyArray<ContainerKey>,
  protectedLines: ReadonlyArray<boolean>,
  start: number,
  containerKey: ContainerKey | undefined,
): number {
  const compatibleEnd = findCompatibleContainerEnd(containerKeys, start - 1);

  for (let index = start; index < containerContents.length; index++) {
    if (index > compatibleEnd) {
      return index - 1;
    }

    if (protectedLines[index] === true) {
      continue;
    }

    if (
      containerKey !== undefined &&
      !isCompatibleContainerKey(
        containerKeys[index] ?? ROOT_CONTAINER_KEY,
        containerKey,
      )
    ) {
      return index - 1;
    }

    if (parsePrettierIgnoreDirective(containerContents[index]) === 'end') {
      return index;
    }
  }

  return containerContents.length - 1;
}

function findNextNonBlankLine(
  lines: ReadonlyArray<string>,
  containerKeys: ReadonlyArray<ContainerKey>,
  start: number,
  containerKey?: ContainerKey,
): number | undefined {
  for (let index = start; index < lines.length; index++) {
    if (
      containerKey !== undefined &&
      !isCompatibleContainerKey(
        containerKeys[index] ?? ROOT_CONTAINER_KEY,
        containerKey,
      )
    ) {
      return undefined;
    }

    if (lines[index]?.trim() !== '') {
      return index;
    }
  }

  return undefined;
}

function findIgnoredMarkdownBlockEnd(
  lines: ReadonlyArray<string>,
  start: number,
): number {
  const tableBlock = findMarkdownTableBlock(lines, toLineIndex(start));

  if (tableBlock !== undefined) {
    return tableBlock.end;
  }

  const listItem = parseListItemStart(lines[start]);

  if (listItem !== undefined && listItem.markerIndent <= 3) {
    return findListItemBlockEnd(lines, start, listItem);
  }

  if (isBlockquoteLine(lines[start])) {
    return findBlockquoteBlockEnd(lines, start);
  }

  return start;
}

function parseListItemStart(
  line: string | undefined,
): ListItemStart | undefined {
  if (line === undefined) {
    return undefined;
  }

  const indent = scanMarkdownIndent(line);

  const marker = /^(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$)/.exec(
    line.slice(indent.offset),
  )?.[0];

  if (marker === undefined) {
    return undefined;
  }

  const contentOffset = indent.offset + marker.length;

  return {
    contentIndent: countMarkdownColumns(line, contentOffset),
    markerIndent: indent.column,
  };
}

function findListItemBlockEnd(
  lines: ReadonlyArray<string>,
  start: number,
  listItem: ListItemStart,
): number {
  let end = start;

  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index];

    if (line === undefined) {
      break;
    }

    if (
      line.trim() !== '' &&
      scanMarkdownIndent(line).column < listItem.contentIndent
    ) {
      break;
    }

    end = index;
  }

  return end;
}

function findBlockquoteBlockEnd(
  lines: ReadonlyArray<string>,
  start: number,
): number {
  let end = start;

  for (let index = start + 1; index < lines.length; index++) {
    if (!isBlockquoteLine(lines[index])) {
      break;
    }

    end = index;
  }

  return end;
}

function isBlockquoteLine(line: string | undefined): boolean {
  if (line === undefined) {
    return false;
  }

  const indent = scanMarkdownIndent(line);

  return indent.column <= 3 && line[indent.offset] === '>';
}

function markLineRange(
  protectedLines: Array<boolean>,
  start: number,
  end: number,
): void {
  for (let index = start; index <= end; index++) {
    protectedLines[index] = true;
  }
}

function findFrontMatterEnd(lines: ReadonlyArray<string>): number | undefined {
  const delimiter = parseOpeningFrontMatterDelimiter(lines[0]);

  if (delimiter === undefined) {
    return undefined;
  }

  for (let index = 1; index < lines.length; index++) {
    if (parseClosingFrontMatterDelimiter(lines[index]) === delimiter) {
      if (hasPlausibleFrontMatterBody(lines, delimiter, index)) {
        return index;
      }

      return undefined;
    }
  }

  return undefined;
}

function parseOpeningFrontMatterDelimiter(
  line: string | undefined,
): string | undefined {
  if (line === undefined) {
    return undefined;
  }

  return parseFrontMatterDelimiter(line.replace(/^\uFEFF/, ''));
}

function parseClosingFrontMatterDelimiter(
  line: string | undefined,
): string | undefined {
  const delimiter = parseFrontMatterDelimiter(line);

  if (delimiter !== undefined) {
    return delimiter;
  }

  if (/^\.\.\.[ \t\r]*$/.test(line ?? '')) {
    return '---';
  }

  return undefined;
}

function parseFrontMatterDelimiter(
  line: string | undefined,
): string | undefined {
  if (line === undefined) {
    return undefined;
  }

  const match = /^(---|\+\+\+)[ \t\r]*$/.exec(line);

  return match?.[1];
}

function hasPlausibleFrontMatterBody(
  lines: ReadonlyArray<string>,
  delimiter: string,
  end: number,
): boolean {
  let hasContent = false;
  let hasMetadata = false;
  let hasNonCommentContent = false;

  for (let index = 1; index < end; index++) {
    const line = lines[index];

    if (line === undefined || line.trim() === '') {
      continue;
    }

    hasContent = true;

    if (line.trim().startsWith('#')) {
      continue;
    }

    hasNonCommentContent = true;

    if (isPlausibleFrontMatterMetadataLine(line, delimiter)) {
      hasMetadata = true;
    }

    if (delimiter === '---' && isPlausibleYamlDocumentBodyLine(line.trim())) {
      hasMetadata = true;
    }
  }

  return !hasContent || !hasNonCommentContent || hasMetadata;
}

function isPlausibleFrontMatterMetadataLine(
  line: string,
  delimiter: string,
): boolean {
  const trimmed = line.trim();

  if (delimiter === '---') {
    return isPlausibleYamlMetadataLine(trimmed);
  }

  return isPlausibleTomlMetadataLine(trimmed);
}

function isPlausibleYamlMetadataLine(line: string): boolean {
  if (line.startsWith('#')) {
    return false;
  }

  return (
    isPlausibleYamlKeyLine(line) ||
    /^-\s+/.test(line) ||
    /^-\s+["'][^"']+["'][ \t]*:/.test(line) ||
    /^-\s+[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*[ \t]*:/.test(line)
  );
}

function isPlausibleYamlDocumentBodyLine(line: string): boolean {
  return (
    isPlausibleYamlMetadataLine(line) ||
    /^%[A-Za-z]/.test(line) ||
    /^(?:[|>][+-]?\d*|&[A-Za-z0-9_-]+(?:\s+[|>][+-]?\d*)?|\*[A-Za-z0-9_-]+)[ \t]*$/.test(
      line,
    ) ||
    /^[{["']/.test(line) ||
    /^(?:[-+]?(?:\d|\.\d)|true\b|false\b|null\b|~[ \t]*$)/.test(line)
  );
}

function isPlausibleYamlKeyLine(line: string): boolean {
  return (
    /^["'][^"']+["'][ \t]*:/.test(line) ||
    /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*[ \t]*:/.test(line)
  );
}

function isPlausibleTomlMetadataLine(line: string): boolean {
  return (
    /^[A-Za-z0-9_".-]+[ \t]*=/.test(line) ||
    /^\[[A-Za-z0-9_".-]+][ \t]*$/.test(line) ||
    /^\[\[[A-Za-z0-9_".-]+]][ \t]*$/.test(line)
  );
}

function parseFenceStart(line: string): FenceStart | undefined {
  const indent = scanMarkdownIndent(line);

  if (indent.column > 3) {
    return undefined;
  }

  const char = line[indent.offset];

  if (char !== '`' && char !== '~') {
    return undefined;
  }

  const length = countRun(line, indent.offset, char);

  if (length < 3) {
    return undefined;
  }

  return { char, length, offset: indent.offset };
}

function isMarkdownTableFenceStart(line: string, fence: FenceStart): boolean {
  const language = readFenceLanguage(line, fence);

  return MARKDOWN_TABLE_FENCE_LANGUAGES.some(
    (markdownLanguage) => markdownLanguage === language,
  );
}

function readFenceLanguage(
  line: string,
  fence: FenceStart,
): string | undefined {
  const info = line.slice(fence.offset + fence.length).trim();

  if (info === '') {
    return undefined;
  }

  return info.split(/\s+/, 1)[0]?.toLowerCase();
}

function findFenceEnd(
  originalLines: ReadonlyArray<string>,
  containerContents: ReadonlyArray<string>,
  containerKeys: ReadonlyArray<ContainerKey>,
  start: number,
  fence: FenceStart,
): number {
  const containerKey = containerKeys[start] ?? ROOT_CONTAINER_KEY;

  if (containerKey === ROOT_CONTAINER_KEY) {
    for (let index = start + 1; index < originalLines.length; index++) {
      const line = originalLines[index];

      if (line !== undefined && isFenceEnd(line, fence)) {
        return index;
      }
    }

    return originalLines.length - 1;
  }

  const compatibleEnd = findCompatibleContainerEnd(containerKeys, start);

  for (let index = start + 1; index <= compatibleEnd; index++) {
    const line = containerContents[index];

    if (line !== undefined && isFenceEnd(line, fence)) {
      return index;
    }
  }

  return compatibleEnd;
}

function isFenceEnd(line: string, fence: FenceStart): boolean {
  const indent = scanMarkdownIndent(line);

  if (indent.column > 3) {
    return false;
  }

  const fenceLength = countRun(line, indent.offset, fence.char);

  return (
    fenceLength >= fence.length &&
    line.slice(indent.offset + fenceLength).trim() === ''
  );
}

function isIndentedCodeLine(
  containerLines: ReadonlyArray<ContainerLine>,
  index: number,
  listContinuationTableRows: ReadonlyArray<boolean>,
  footnoteContinuationTableRows: ReadonlyArray<boolean>,
): boolean {
  const containerLine = containerLines[index];

  if (containerLine === undefined || containerLine.content.trim() === '') {
    return false;
  }

  if (isIndentedContainerLine(containerLine)) {
    return (
      listContinuationTableRows[index] !== true &&
      footnoteContinuationTableRows[index] !== true
    );
  }

  return (
    scanMarkdownIndent(containerLine.content).column >= 4 &&
    listContinuationTableRows[index] !== true &&
    footnoteContinuationTableRows[index] !== true
  );
}

function isIndentedContainerLine(containerLine: ContainerLine): boolean {
  return (
    containerLine.key === 'indent' || containerLine.key.endsWith('/indent')
  );
}

function findListContinuationTableRows(
  containerLines: ReadonlyArray<ContainerLine>,
): ReadonlyArray<boolean> {
  const activeListItemsByKey = new Map<ContainerKey, Array<ListItemStart>>();
  const tableRows: Array<boolean> = [];

  for (const containerLine of containerLines) {
    const line = containerLine.content;

    if (line.trim() === '') {
      tableRows.push(false);
      continue;
    }

    const activeListItems = getActiveListItemsForKey(
      activeListItemsByKey,
      containerLine.key,
    );
    const indent = scanMarkdownIndent(line);
    removeClosedListItems(activeListItems, indent.column);

    tableRows.push(isActiveListTableRow(line, indent.column, activeListItems));

    const listItem = parseListItemStart(line);

    if (
      listItem !== undefined &&
      isListItemInActiveFlow(activeListItems, listItem)
    ) {
      activeListItems.push(listItem);
    }
  }

  return tableRows;
}

function getActiveListItemsForKey(
  activeListItemsByKey: Map<ContainerKey, Array<ListItemStart>>,
  key: ContainerKey,
): Array<ListItemStart> {
  const activeListItems = activeListItemsByKey.get(key);

  if (activeListItems !== undefined) {
    return activeListItems;
  }

  const nextActiveListItems: Array<ListItemStart> = [];
  activeListItemsByKey.set(key, nextActiveListItems);

  return nextActiveListItems;
}

function removeClosedListItems(
  activeListItems: Array<ListItemStart>,
  lineIndent: MarkdownColumn,
): void {
  while (activeListItems.length > 0) {
    const activeListItem = activeListItems[activeListItems.length - 1];

    if (
      activeListItem === undefined ||
      lineIndent >= activeListItem.contentIndent
    ) {
      return;
    }

    activeListItems.pop();
  }
}

function isActiveListTableRow(
  line: string,
  lineIndent: MarkdownColumn,
  activeListItems: ReadonlyArray<ListItemStart>,
): boolean {
  const row = parsePipedRow(line);

  if (row === undefined) {
    return false;
  }

  const listItem = activeListItems[activeListItems.length - 1];

  if (listItem === undefined) {
    return false;
  }

  return lineIndent - listItem.contentIndent < 4;
}

function isListItemInActiveFlow(
  activeListItems: ReadonlyArray<ListItemStart>,
  listItem: ListItemStart,
): boolean {
  if (listItem.markerIndent <= 3) {
    return true;
  }

  const parentListItem = activeListItems[activeListItems.length - 1];

  if (parentListItem === undefined) {
    return false;
  }

  return (
    parentListItem.contentIndent <= listItem.markerIndent &&
    listItem.markerIndent <= parentListItem.contentIndent + 3
  );
}

function findFootnoteContinuationTableRows(
  containerLines: ReadonlyArray<ContainerLine>,
): ReadonlyArray<boolean> {
  const tableRows: Array<boolean> = [];
  const footnotesByKey = new Map<ContainerKey, FootnoteDefinitionStart>();

  for (const containerLine of containerLines) {
    const line = containerLine.content;

    if (line.trim() === '') {
      tableRows.push(false);
      continue;
    }

    const footnoteStart = parseFootnoteDefinitionStart(line);

    if (footnoteStart !== undefined) {
      footnotesByKey.set(containerLine.key, footnoteStart);
      tableRows.push(false);
      continue;
    }

    const indent = scanMarkdownIndent(line).column;
    let footnote = footnotesByKey.get(containerLine.key);

    if (footnote !== undefined && indent < footnote.contentIndent) {
      footnotesByKey.delete(containerLine.key);
      footnote = undefined;
    }

    tableRows.push(isFootnoteContinuationTableRow(line, indent, footnote));
  }

  return tableRows;
}

function parseFootnoteDefinitionStart(
  line: string,
): FootnoteDefinitionStart | undefined {
  const indent = scanMarkdownIndent(line);

  if (indent.column > 3) {
    return undefined;
  }

  const marker = /^\[\^[^\]\r\n]+]:/.exec(line.slice(indent.offset));

  if (marker === null) {
    return undefined;
  }

  return {
    contentIndent: toMarkdownColumn(indent.column + 4),
  };
}

function isFootnoteContinuationTableRow(
  line: string,
  lineIndent: MarkdownColumn,
  footnote: FootnoteDefinitionStart | undefined,
): boolean {
  if (footnote === undefined || lineIndent < footnote.contentIndent) {
    return false;
  }

  const row = parsePipedRow(line);

  if (row === undefined) {
    return false;
  }

  return lineIndent - footnote.contentIndent < 4;
}
