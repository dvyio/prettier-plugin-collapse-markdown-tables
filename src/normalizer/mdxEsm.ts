/**
 * @fileoverview Finds MDX ESM blocks and scans JavaScript-like text safely.
 */

import type {
  ContainerKey,
  JavaScriptScanState,
  MdxFlowExpressionLineScanResult,
  MdxFlowExpressionScanState,
} from './types.js';

import { scanJavaScriptLikeText } from './javascriptScanner.js';
import { findCompatibleContainerEnd, toScanTextOffset } from './lineUtils.js';

/** Returns true for MDX import or export lines that start an ESM protected block. */
export function isMdxEsmStart(line: string): boolean {
  const text = line.trimStart();

  return isMdxImportStart(text) || isMdxExportStart(text);
}

function isMdxImportStart(text: string): boolean {
  return (
    /^import\s*["']/.test(text) ||
    /^import\s+(?:type\s+)?[{*]/.test(text) ||
    /^import\s+(?:type\s+)?[A-Za-z_$][\w$]*(?:\s*,|\s+from\b)/.test(text)
  );
}

function isMdxExportStart(text: string): boolean {
  return /^export\s+(?:default\b|const\b|let\b|var\b|function\b|async\s+function\b|class\b|abstract\s+class\b|declare\s+(?:const\b|let\b|var\b|function\b|class\b|abstract\s+class\b|namespace\b|type\b|interface\b|enum\b)|namespace\b|\{|\*|type\b|interface\b|enum\b)/.test(
    text,
  );
}

/** Returns true for lines that start an MDX flow expression. */
export function isMdxFlowExpressionStart(line: string): boolean {
  return line.trimStart().startsWith('{');
}

/**
 * Finds the end of an MDX flow expression while ignoring braces inside comments, strings, and regexes.
 */
export function findMdxFlowExpressionEnd(
  lines: ReadonlyArray<string>,
  containerKeys: ReadonlyArray<ContainerKey>,
  start: number,
): number {
  const startLine = lines[start];

  if (startLine === undefined) {
    return start;
  }

  const openingBraceOffset = startLine.indexOf('{');

  if (openingBraceOffset === -1) {
    return start;
  }

  const compatibleEnd = findCompatibleContainerEnd(containerKeys, start);
  let state: MdxFlowExpressionScanState = {
    braceDepth: 0,
    canStartRegex: true,
    isBlockComment: false,
    quote: undefined,
  };
  let firstBlankLine: number | undefined;

  for (let index = start; index <= compatibleEnd; index++) {
    const line = lines[index];

    if (line === undefined) {
      continue;
    }

    const scanStart = index === start ? openingBraceOffset : 0;
    const result = scanMdxFlowExpressionLine(line, state, scanStart);
    state = result.state;

    if (result.isClosed) {
      return index;
    }

    if (index > start && firstBlankLine === undefined && line.trim() === '') {
      firstBlankLine = index;
    }
  }

  return firstBlankLine ?? compatibleEnd;
}

function scanMdxFlowExpressionLine(
  line: string,
  state: MdxFlowExpressionScanState,
  startOffset: number,
): MdxFlowExpressionLineScanResult {
  let braceDepth = state.braceDepth;
  const result = scanJavaScriptLikeText(
    line,
    {
      canStartRegex: state.canStartRegex,
      isBlockComment: state.isBlockComment,
      quote: state.quote,
    },
    {
      lineCommentBehavior: 'stop',
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
      startOffset: toScanTextOffset(startOffset),
    },
  );

  return {
    isClosed: result.stopReason === 'callback',
    state: {
      braceDepth,
      canStartRegex: result.state.canStartRegex,
      isBlockComment: result.state.isBlockComment,
      quote: result.state.quote,
    },
  };
}

/**
 * Finds the end of an MDX ESM block once JavaScript delimiters close and the line is not continued.
 */
export function findMdxEsmEnd(
  lines: ReadonlyArray<string>,
  containerKeys: ReadonlyArray<ContainerKey>,
  start: number,
): number {
  const compatibleEnd = findCompatibleContainerEnd(containerKeys, start);
  let state: JavaScriptScanState = {
    braceDepth: 0,
    bracketDepth: 0,
    canStartRegex: true,
    isBlockComment: false,
    parenDepth: 0,
    quote: undefined,
  };
  let firstBlankLine: number | undefined;

  for (let index = start; index <= compatibleEnd; index++) {
    const line = lines[index];

    if (line === undefined) {
      continue;
    }

    state = scanJavaScriptLine(line, state);

    if (index > start && line.trim() === '' && isJavaScriptScanClosed(state)) {
      return index - 1;
    }

    if (index > start && firstBlankLine === undefined && line.trim() === '') {
      firstBlankLine = index;
    }

    if (
      line.trim() !== '' &&
      isJavaScriptScanClosed(state) &&
      !isJavaScriptLineContinued(line)
    ) {
      return index;
    }
  }

  return firstBlankLine ?? compatibleEnd;
}

function scanJavaScriptLine(
  line: string,
  state: JavaScriptScanState,
): JavaScriptScanState {
  let braceDepth = state.braceDepth;
  let bracketDepth = state.bracketDepth;
  let parenDepth = state.parenDepth;
  const result = scanJavaScriptLikeText(
    line,
    {
      canStartRegex: state.canStartRegex,
      isBlockComment: state.isBlockComment,
      quote: state.quote,
    },
    {
      lineCommentBehavior: 'stop',
      onCodeCharacter: ({ char }) => {
        if (char === '{') {
          braceDepth++;

          return {
            canStartRegex: true,
            type: 'continue',
          };
        }

        if (char === '}' && braceDepth > 0) {
          braceDepth--;

          return {
            canStartRegex: false,
            type: 'continue',
          };
        }

        if (char === '[') {
          bracketDepth++;

          return {
            canStartRegex: true,
            type: 'continue',
          };
        }

        if (char === ']' && bracketDepth > 0) {
          bracketDepth--;

          return {
            canStartRegex: false,
            type: 'continue',
          };
        }

        if (char === '(') {
          parenDepth++;

          return {
            canStartRegex: true,
            type: 'continue',
          };
        }

        if (char === ')' && parenDepth > 0) {
          parenDepth--;

          return {
            canStartRegex: false,
            type: 'continue',
          };
        }

        return undefined;
      },
    },
  );

  return {
    braceDepth,
    bracketDepth,
    canStartRegex: result.state.canStartRegex,
    isBlockComment: result.state.isBlockComment,
    parenDepth,
    quote: result.state.quote,
  };
}

function isJavaScriptScanClosed(state: JavaScriptScanState): boolean {
  return (
    !state.isBlockComment &&
    state.quote === undefined &&
    state.braceDepth === 0 &&
    state.bracketDepth === 0 &&
    state.parenDepth === 0
  );
}

function isJavaScriptLineContinued(line: string): boolean {
  const trimmed = stripJavaScriptLineComment(line).trimEnd();

  return (
    /(?:[=({\[,:?]|\b(?:default|from|as|type))$/.test(trimmed) ||
    hasTrailingJavaScriptContinuationOperator(trimmed) ||
    trimmed.endsWith('=>')
  );
}

function hasTrailingJavaScriptContinuationOperator(line: string): boolean {
  if (line.endsWith('?.') || line.endsWith('??')) {
    return true;
  }

  if (line.endsWith('&&') || line.endsWith('||')) {
    return true;
  }

  if (line.endsWith('+') && !line.endsWith('++')) {
    return true;
  }

  return line.endsWith('.') && !/\d\.$/.test(line);
}

function stripJavaScriptLineComment(line: string): string {
  const result = scanJavaScriptLikeText(
    line,
    {
      canStartRegex: true,
      isBlockComment: false,
      quote: undefined,
    },
    {
      lineCommentBehavior: 'stop',
    },
  );

  if (result.stopReason === 'line-comment' && result.stopOffset !== undefined) {
    return line.slice(0, result.stopOffset);
  }

  return line;
}
