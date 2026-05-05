/**
 * @fileoverview Finds complete MDX JSX regions that table normalization must not touch.
 */

import type {
  ContainerKey,
  LineIndex,
  MarkdownOffset,
  MdxJsxQuote,
  MdxJsxScanText,
  MdxJsxTag,
  ScanTextOffset,
} from './types.js';

import { assertNever } from './assertNever.js';
import { scanJavaScriptLikeText } from './javascriptScanner.js';
import {
  isCompatibleContainerKey,
  isPreviousLineNonBlank,
  ROOT_CONTAINER_KEY,
  scanMarkdownIndent,
  toLineIndex,
  toScanTextOffset,
} from './lineUtils.js';
import { findMarkdownTableBlock, looksLikePipedRow } from './tableRows.js';

const MDX_JSX_FRAGMENT_NAME = '<>';
const MDX_JSX_IDENTIFIER_PATTERN = String.raw`[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}-]*`;
const MDX_JSX_NAME_PATTERN = new RegExp(
  `^${MDX_JSX_IDENTIFIER_PATTERN}(?:[.:]${MDX_JSX_IDENTIFIER_PATTERN})*`,
  'u',
);

function createMdxJsxScanText(
  lines: ReadonlyArray<string>,
  start: LineIndex,
  end: LineIndex,
): MdxJsxScanText {
  const lineStartOffsets: Array<ScanTextOffset | undefined> = [];
  let text = '';

  for (let index = start; index <= end; index++) {
    const line = lines[index] ?? '';

    if (index > start) {
      text += '\n';
    }

    lineStartOffsets[index] = toScanTextOffset(text.length);
    text += line;
  }

  return {
    lines,
    lineStartOffsets,
    text,
  };
}

/** Returns true for JSX-like lines at Markdown block indentation, excluding HTML declarations. */
export function isMdxJsxStartCandidate(line: string): boolean {
  const indent = scanMarkdownIndent(line);

  if (indent.column > 3 || line[indent.offset] !== '<') {
    return false;
  }

  const next = line[indent.offset + 1];

  return next !== undefined && next !== '!' && next !== '?';
}

/**
 * Finds a complete MDX JSX region when it starts at a block boundary or after a Markdown table.
 */
export function findMdxJsxEnd(
  originalLines: ReadonlyArray<string>,
  containerLines: ReadonlyArray<string>,
  containerKeys: ReadonlyArray<ContainerKey>,
  start: LineIndex,
): LineIndex | undefined {
  const containerKey = containerKeys[start] ?? ROOT_CONTAINER_KEY;
  const lines =
    containerKey === ROOT_CONTAINER_KEY ? originalLines : containerLines;
  const line = lines[start];

  if (
    line === undefined ||
    (isPreviousLineNonBlank(containerLines, start) &&
      !isPreviousLineMarkdownTable(containerLines, start))
  ) {
    return undefined;
  }

  const indent = scanMarkdownIndent(line);

  if (indent.column > 3) {
    return undefined;
  }

  const compatibleEnd = findMdxJsxCompatibleEnd(
    containerKeys,
    containerLines,
    start,
  );
  const scanEnd = findNextMdxJsxGreaterThanLine(
    lines,
    start,
    indent.offset,
    compatibleEnd,
  );

  if (scanEnd === undefined) {
    return undefined;
  }

  const scanText = createMdxJsxScanText(lines, start, compatibleEnd);
  const startOffset = toScanTextOffset(
    (scanText.lineStartOffsets[start] ?? scanText.text.length) + indent.offset,
  );
  const compatibleTextEnd = getMdxJsxLineEndOffset(scanText, compatibleEnd);

  return findMdxJsxEndInScanText(scanText, startOffset, compatibleTextEnd);
}

function findMdxJsxEndInScanText(
  scanText: MdxJsxScanText,
  startOffset: ScanTextOffset,
  compatibleTextEnd: ScanTextOffset,
): LineIndex | undefined {
  if (startOffset >= compatibleTextEnd) {
    return undefined;
  }

  const startTag = parseMdxJsxTagAt(
    scanText.text,
    startOffset,
    compatibleTextEnd,
  );

  if (startTag === undefined) {
    return undefined;
  }

  switch (startTag.type) {
    case 'closing':
    case 'self-closing':
      return getLineIndexForOffset(
        scanText.lineStartOffsets,
        startTag.endOffset,
      );

    case 'opening':
      break;

    default:
      return assertNever(startTag.type);
  }

  const openTags = [startTag.name];
  let offset = startTag.endOffset;

  while (offset < compatibleTextEnd) {
    const char = scanText.text[offset];

    if (char === '{') {
      const expressionEnd = findMdxJsxChildExpressionEnd(
        scanText.text,
        offset,
        compatibleTextEnd,
      );

      if (expressionEnd !== undefined) {
        offset = expressionEnd;
        continue;
      }

      return undefined;
    }

    if (char !== '<') {
      offset++;
      continue;
    }

    const tag = parseMdxJsxTagAt(scanText.text, offset, compatibleTextEnd);

    if (tag === undefined) {
      offset++;
      continue;
    }

    switch (tag.type) {
      case 'closing':
        if (!closeMdxJsxTag(openTags, tag.name)) {
          return undefined;
        }
        break;

      case 'opening':
        openTags.push(tag.name);
        break;

      case 'self-closing':
        break;

      default:
        return assertNever(tag.type);
    }

    if (openTags.length === 0) {
      return getLineIndexForOffset(scanText.lineStartOffsets, tag.endOffset);
    }

    offset = tag.endOffset;
  }

  return undefined;
}

function findNextMdxJsxGreaterThanLine(
  lines: ReadonlyArray<string>,
  start: LineIndex,
  startColumn: MarkdownOffset,
  end: LineIndex,
): LineIndex | undefined {
  for (let index = start; index <= end; index++) {
    const line = lines[index];

    if (line === undefined) {
      continue;
    }

    const searchStart = index === start ? startColumn : 0;

    if (line.includes('>', searchStart)) {
      return toLineIndex(index);
    }
  }

  return undefined;
}

function findMdxJsxChildExpressionEnd(
  text: string,
  start: ScanTextOffset,
  end: ScanTextOffset,
): ScanTextOffset | undefined {
  let braceDepth = 0;
  const result = scanJavaScriptLikeText(
    text,
    {
      canStartRegex: true,
      isBlockComment: false,
      quote: undefined,
    },
    {
      endOffset: end,
      lineCommentBehavior: 'skip-to-line-end',
      onCodeCharacter: ({ char, index }) => {
        if (char === '{') {
          braceDepth++;

          return {
            canStartRegex: true,
            type: 'continue',
          };
        }

        if (char === '}' && braceDepth > 0) {
          braceDepth--;

          if (braceDepth === 0) {
            return {
              canStartRegex: false,
              stopOffset: toScanTextOffset(index + 1),
              type: 'stop',
            };
          }

          return {
            canStartRegex: false,
            type: 'continue',
          };
        }

        return undefined;
      },
      startOffset: start,
    },
  );

  if (result.stopReason === 'callback') {
    return result.stopOffset;
  }

  return undefined;
}

function findMdxJsxCompatibleEnd(
  containerKeys: ReadonlyArray<ContainerKey>,
  containerLines: ReadonlyArray<string>,
  start: LineIndex,
): LineIndex {
  const containerKey = containerKeys[start] ?? ROOT_CONTAINER_KEY;
  let end: number = start;

  for (let index = start + 1; index < containerKeys.length; index++) {
    const key = containerKeys[index] ?? ROOT_CONTAINER_KEY;

    if (
      !isCompatibleContainerKey(key, containerKey) &&
      !isRootMdxJsxTagEndLine(containerLines[index], key, containerKey)
    ) {
      break;
    }

    end = index;
  }

  return toLineIndex(end);
}

function isRootMdxJsxTagEndLine(
  line: string | undefined,
  key: ContainerKey,
  startKey: ContainerKey,
): boolean {
  return (
    startKey === ROOT_CONTAINER_KEY &&
    key === 'blockquote' &&
    line?.trim() === ''
  );
}

function isPreviousLineMarkdownTable(
  lines: ReadonlyArray<string>,
  start: number,
): boolean {
  let tableStart = start - 1;

  while (tableStart >= 0 && looksLikePipedRow(lines[tableStart] ?? '')) {
    tableStart--;
  }

  tableStart++;

  const tableBlock = findMarkdownTableBlock(lines, toLineIndex(tableStart));

  return tableBlock?.end === start - 1;
}

function getMdxJsxLineEndOffset(
  scanText: MdxJsxScanText,
  lineIndex: LineIndex,
): ScanTextOffset {
  const lineStart = scanText.lineStartOffsets[lineIndex];
  const line = scanText.lines[lineIndex];

  if (lineStart === undefined || line === undefined) {
    return toScanTextOffset(scanText.text.length);
  }

  return toScanTextOffset(lineStart + line.length);
}

function parseMdxJsxTagAt(
  text: string,
  start: ScanTextOffset,
  end: ScanTextOffset,
): MdxJsxTag | undefined {
  if (start >= end || text[start] !== '<') {
    return undefined;
  }

  const next = text[start + 1];

  if (start + 1 >= end || next === undefined || next === '!' || next === '?') {
    return undefined;
  }

  if (next === '>') {
    return {
      endOffset: toScanTextOffset(start + 2),
      name: MDX_JSX_FRAGMENT_NAME,
      type: 'opening',
    };
  }

  if (next === '/' && start + 2 < end && text[start + 2] === '>') {
    return {
      endOffset: toScanTextOffset(start + 3),
      name: MDX_JSX_FRAGMENT_NAME,
      type: 'closing',
    };
  }

  let nameStart = start + 1;
  let type: MdxJsxTag['type'] = 'opening';

  if (next === '/') {
    nameStart = start + 2;
    type = 'closing';
  }

  const name = parseMdxJsxName(text, nameStart, end);

  if (name === undefined) {
    return undefined;
  }

  const tagEnd = findMdxJsxTagEnd(text, nameStart + name.length, end);

  if (tagEnd === undefined) {
    return undefined;
  }

  if (type === 'opening' && isMdxJsxSelfClosingTag(text, tagEnd)) {
    type = 'self-closing';
  }

  return {
    endOffset: toScanTextOffset(tagEnd + 1),
    name,
    type,
  };
}

function parseMdxJsxName(
  text: string,
  start: number | ScanTextOffset,
  end: ScanTextOffset,
): string | undefined {
  return MDX_JSX_NAME_PATTERN.exec(text.slice(start, end))?.[0];
}

function findMdxJsxTagEnd(
  text: string,
  start: number,
  end: ScanTextOffset,
): ScanTextOffset | undefined {
  let braceDepth = 0;
  let quote: MdxJsxQuote | undefined;

  for (let index = start; index < end; index++) {
    const char = text[index];

    if (char === undefined) {
      break;
    }

    if (quote !== undefined) {
      if (char === '\\') {
        index++;
        continue;
      }

      if (char === quote) {
        quote = undefined;
      }

      continue;
    }

    if (isMdxJsxQuote(char)) {
      quote = char;
      continue;
    }

    if (char === '{') {
      braceDepth++;
      continue;
    }

    if (char === '}' && braceDepth > 0) {
      braceDepth--;
      continue;
    }

    if (braceDepth > 0) {
      continue;
    }

    if (char === '>') {
      return toScanTextOffset(index);
    }
  }

  return undefined;
}

function isMdxJsxQuote(value: string): value is MdxJsxQuote {
  return value === '"' || value === "'" || value === '`';
}

function isMdxJsxSelfClosingTag(text: string, tagEnd: number): boolean {
  for (let index = tagEnd - 1; index >= 0; index--) {
    const char = text[index];

    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      continue;
    }

    return char === '/';
  }

  return false;
}

function closeMdxJsxTag(openTags: Array<string>, name: string): boolean {
  if (openTags[openTags.length - 1] !== name) {
    return false;
  }

  openTags.pop();
  return true;
}

function getLineIndexForOffset(
  lineStartOffsets: ReadonlyArray<ScanTextOffset | undefined>,
  offset: ScanTextOffset,
): LineIndex {
  let lineIndex = 0;
  let hasSeenLine = false;

  for (let index = 0; index < lineStartOffsets.length; index++) {
    const lineStart = lineStartOffsets[index];

    if (lineStart === undefined) {
      if (hasSeenLine) {
        break;
      }

      continue;
    }

    hasSeenLine = true;

    if (lineStart > offset) {
      break;
    }

    lineIndex = index;
  }

  return toLineIndex(lineIndex);
}
