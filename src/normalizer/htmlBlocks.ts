/**
 * @fileoverview Finds Markdown HTML blocks that table normalization must not touch.
 */

import type {
  ContainerKey,
  HtmlAttributeQuote,
  HtmlBlockStart,
} from './types.js';

import {
  findCompatibleContainerEnd,
  isPreviousLineNonBlank,
  scanMarkdownIndent,
} from './lineUtils.js';

const RAW_HTML_BLOCK_TAG_NAMES = [
  'pre',
  'script',
  'style',
  'textarea',
] as const;
const HTML_BLOCK_TAG_NAMES = [
  'address',
  'article',
  'aside',
  'base',
  'basefont',
  'blockquote',
  'body',
  'caption',
  'center',
  'col',
  'colgroup',
  'dd',
  'details',
  'dialog',
  'dir',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'frame',
  'frameset',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hr',
  'html',
  'iframe',
  'legend',
  'li',
  'link',
  'main',
  'menu',
  'menuitem',
  'nav',
  'noframes',
  'ol',
  'optgroup',
  'option',
  'p',
  'param',
  'search',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'title',
  'tr',
  'track',
  'ul',
] as const;

/**
 * Finds the end of an HTML comment without crossing out of the current Markdown container.
 *
 * @param lines - Markdown lines to scan.
 * @param containerKeys - parsed container key for each line.
 * @param start - line index where the possible HTML comment starts.
 * @returns the closing comment line, or `undefined` when the start line is not an HTML comment.
 */
export function findHtmlCommentEnd(
  lines: ReadonlyArray<string>,
  containerKeys: ReadonlyArray<ContainerKey>,
  start: number,
): number | undefined {
  const line = lines[start];

  if (!line?.trimStart().startsWith('<!--')) {
    return undefined;
  }

  const compatibleEnd = findCompatibleContainerEnd(containerKeys, start);

  if (line.trim() === '<!--') {
    for (let index = start + 1; index <= compatibleEnd; index++) {
      const commentLine = lines[index];

      if (
        commentLine !== undefined &&
        !commentLine.trimStart().startsWith('<!--') &&
        commentLine.includes('-->')
      ) {
        return index;
      }
    }

    return compatibleEnd;
  }

  for (let index = start; index <= compatibleEnd; index++) {
    if (lines[index]?.includes('-->') === true) {
      return index;
    }
  }

  return compatibleEnd;
}

/**
 * Finds the end of a raw HTML block for tags whose contents can contain Markdown table text.
 *
 * @param lines - Markdown lines to scan.
 * @param containerKeys - parsed container key for each line.
 * @param start - line index where the possible raw HTML block starts.
 * @returns the closing tag line, or `undefined` when the start line is not a raw HTML block.
 */
export function findRawHtmlEnd(
  lines: ReadonlyArray<string>,
  containerKeys: ReadonlyArray<ContainerKey>,
  start: number,
): number | undefined {
  const tagName = parseHtmlTagName(lines[start]);

  if (tagName === undefined || !isRawHtmlBlockTagName(tagName)) {
    return undefined;
  }

  const compatibleEnd = findCompatibleContainerEnd(containerKeys, start);
  const closingTagPattern = new RegExp(`</${escapeRegExp(tagName)}\\s*>`, 'i');

  for (let index = start; index <= compatibleEnd; index++) {
    if (closingTagPattern.test(lines[index] ?? '')) {
      return index;
    }
  }

  return compatibleEnd;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds the end of a CommonMark HTML block using either its closing marker or the next blank line.
 *
 * @param lines - Markdown lines to scan.
 * @param containerKeys - parsed container key for each line.
 * @param start - line index where the possible HTML block starts.
 * @returns the final protected HTML block line, or `undefined` when no block starts there.
 */
export function findHtmlBlockEnd(
  lines: ReadonlyArray<string>,
  containerKeys: ReadonlyArray<ContainerKey>,
  start: number,
): number | undefined {
  const blockStart = parseHtmlBlockStart(lines, start);

  if (blockStart === undefined) {
    return undefined;
  }

  const compatibleEnd = findCompatibleContainerEnd(containerKeys, start);

  if (blockStart.type !== 'blank-line') {
    for (let index = start; index <= compatibleEnd; index++) {
      if (lines[index]?.includes(blockStart.endMarker) === true) {
        return index;
      }
    }

    return compatibleEnd;
  }

  for (let index = start + 1; index <= compatibleEnd; index++) {
    if (lines[index]?.trim() === '') {
      return index - 1;
    }
  }

  return compatibleEnd;
}

function parseHtmlBlockStart(
  lines: ReadonlyArray<string>,
  start: number,
): HtmlBlockStart | undefined {
  const line = lines[start];

  if (line === undefined) {
    return undefined;
  }

  const indent = scanMarkdownIndent(line);

  if (indent.column > 3) {
    return undefined;
  }

  const text = line.slice(indent.offset);

  if (text.startsWith('<![CDATA[')) {
    return {
      endMarker: ']]>',
      type: 'cdata',
    };
  }

  if (text.startsWith('<?')) {
    return {
      endMarker: '?>',
      type: 'processing-instruction',
    };
  }

  if (text.startsWith('<!') && !text.startsWith('<!--')) {
    return {
      endMarker: '>',
      type: 'declaration',
    };
  }

  if (isListedHtmlBlockStart(text)) {
    return { type: 'blank-line' };
  }

  if (isCompleteHtmlTagLine(text) && !isPreviousLineNonBlank(lines, start)) {
    return { type: 'blank-line' };
  }

  return undefined;
}

function isListedHtmlBlockStart(text: string): boolean {
  const tagName = parseHtmlTagName(text);

  return tagName !== undefined && isHtmlBlockTagName(tagName);
}

function isCompleteHtmlTagLine(text: string): boolean {
  const tagName = parseHtmlTagName(text);
  const tagEnd = findCompleteHtmlTagEnd(text);

  return (
    tagName !== undefined &&
    tagEnd !== undefined &&
    text.slice(tagEnd + 1).trim() === '' &&
    !isRawHtmlBlockTagName(tagName)
  );
}

function findCompleteHtmlTagEnd(text: string): number | undefined {
  if (!text.startsWith('<')) {
    return undefined;
  }

  let index = 1;

  if (text[index] === '/') {
    index++;
  }

  if (!isHtmlTagNameStart(text[index])) {
    return undefined;
  }

  index++;

  while (isHtmlTagNamePart(text[index])) {
    index++;
  }

  if (!isHtmlTagNameBoundary(text[index])) {
    return undefined;
  }

  let quote: HtmlAttributeQuote | undefined = undefined;

  for (; index < text.length; index++) {
    const char = text[index];

    if (char === undefined) {
      continue;
    }

    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
      }

      continue;
    }

    if (isHtmlAttributeQuote(char)) {
      quote = char;
      continue;
    }

    if (char === '<') {
      return undefined;
    }

    if (char === '>') {
      return index;
    }
  }

  return undefined;
}

function isHtmlTagNameStart(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z]/.test(value);
}

function isHtmlTagNamePart(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9-]/.test(value);
}

function isHtmlTagNameBoundary(value: string | undefined): boolean {
  return (
    value === ' ' ||
    value === '\t' ||
    value === '\r' ||
    value === '\n' ||
    value === '/' ||
    value === '>'
  );
}

function isHtmlAttributeQuote(
  value: string | undefined,
): value is HtmlAttributeQuote {
  return value === '"' || value === "'";
}

function parseHtmlTagName(line: string | undefined): string | undefined {
  if (line === undefined) {
    return undefined;
  }

  const indent = scanMarkdownIndent(line);

  if (indent.column > 3) {
    return undefined;
  }

  const match = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?=[\s>/])/.exec(
    line.slice(indent.offset),
  );
  const tagName = match?.[1];

  return tagName?.toLowerCase();
}

function isRawHtmlBlockTagName(value: string): boolean {
  return RAW_HTML_BLOCK_TAG_NAMES.some((tagName) => tagName === value);
}

function isHtmlBlockTagName(value: string): boolean {
  return HTML_BLOCK_TAG_NAMES.some((tagName) => tagName === value);
}
