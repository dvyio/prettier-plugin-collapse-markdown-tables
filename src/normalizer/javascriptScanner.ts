/**
 * @fileoverview Scans JavaScript-like text inside MDX protected regions.
 */

import type { JavaScriptQuote, ScanTextOffset } from './types.js';

import { toScanTextOffset } from './lineUtils.js';

type JavaScriptLikeScanState = {
  readonly canStartRegex: boolean;
  readonly isBlockComment: boolean;
  readonly quote: JavaScriptQuote | undefined;
};

type MutableJavaScriptLikeScanState = {
  canStartRegex: boolean;
  isBlockComment: boolean;
  quote: JavaScriptQuote | undefined;
};

type JavaScriptLikeLineCommentBehavior = 'skip-to-line-end' | 'stop';

type JavaScriptLikeScanContext = {
  readonly char: string;
  readonly index: ScanTextOffset;
  readonly text: string;
};

type JavaScriptLikeScanAction =
  | {
      readonly canStartRegex: boolean;
      readonly stopOffset: ScanTextOffset;
      readonly type: 'stop';
    }
  | {
      readonly canStartRegex: boolean;
      readonly type: 'continue';
    };

type JavaScriptLikeScanOptions = {
  readonly endOffset?: ScanTextOffset;
  readonly lineCommentBehavior: JavaScriptLikeLineCommentBehavior;
  readonly onCodeCharacter?: (
    context: JavaScriptLikeScanContext,
  ) => JavaScriptLikeScanAction | undefined;
  readonly startOffset?: ScanTextOffset;
};

type JavaScriptLikeScanResult = {
  readonly state: JavaScriptLikeScanState;
  readonly stopOffset?: ScanTextOffset;
  readonly stopReason?: 'callback' | 'line-comment';
};

/**
 * Scans JavaScript-like text and lets callers decide how code characters change scan state.
 */
export function scanJavaScriptLikeText(
  text: string,
  state: JavaScriptLikeScanState,
  options: JavaScriptLikeScanOptions,
): JavaScriptLikeScanResult {
  const nextState: MutableJavaScriptLikeScanState = {
    canStartRegex: state.canStartRegex,
    isBlockComment: state.isBlockComment,
    quote: state.quote,
  };
  const startOffset = options.startOffset ?? toScanTextOffset(0);
  const endOffset = options.endOffset ?? toScanTextOffset(text.length);

  assertValidScanOffsets(text, startOffset, endOffset);

  for (let index: number = startOffset; index < endOffset; index++) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === undefined) {
      continue;
    }

    if (nextState.isBlockComment) {
      if (char === '*' && nextChar === '/') {
        nextState.isBlockComment = false;
        index++;
      }

      continue;
    }

    if (nextState.quote !== undefined) {
      if (char === '\\') {
        index++;
        continue;
      }

      if (char === nextState.quote) {
        nextState.quote = undefined;
        nextState.canStartRegex = false;
      }

      continue;
    }

    if (char === '/' && nextChar === '/') {
      if (options.lineCommentBehavior === 'skip-to-line-end') {
        index = findJavaScriptLineEnd(text, toScanTextOffset(index), endOffset);
        continue;
      }

      return {
        state: nextState,
        stopOffset: toScanTextOffset(index),
        stopReason: 'line-comment',
      };
    }

    if (char === '/' && nextChar === '*') {
      nextState.isBlockComment = true;
      index++;
      continue;
    }

    if (char === '/' && nextState.canStartRegex) {
      const regexEnd = findJavaScriptRegexLiteralEnd(text, index);

      if (regexEnd !== undefined && regexEnd < endOffset) {
        index = regexEnd;
        nextState.canStartRegex = false;
        continue;
      }
    }

    if (isJavaScriptQuote(char)) {
      nextState.quote = char;
      continue;
    }

    const action = options.onCodeCharacter?.({
      char,
      index: toScanTextOffset(index),
      text,
    });

    if (action !== undefined) {
      nextState.canStartRegex = action.canStartRegex;

      if (action.type === 'stop') {
        return {
          state: nextState,
          stopOffset: action.stopOffset,
          stopReason: 'callback',
        };
      }

      continue;
    }

    if (isJavaScriptIdentifierStart(char)) {
      const tokenEnd = findJavaScriptIdentifierEnd(text, index);
      const token = text.slice(index, tokenEnd);
      nextState.canStartRegex = isJavaScriptRegexAllowedAfterKeyword(token);
      index = tokenEnd - 1;
      continue;
    }

    if (isJavaScriptNumberStart(char)) {
      nextState.canStartRegex = false;
      continue;
    }

    if (char === ' ' || char === '\t' || char === '\r' || char === '\n') {
      continue;
    }

    nextState.canStartRegex = isJavaScriptRegexAllowedAfterPunctuation(char);
  }

  return {
    state: nextState,
  };
}

/**
 * Finds the end of a JavaScript regex literal, including its trailing flags.
 */
function findJavaScriptRegexLiteralEnd(
  line: string,
  start: number,
): number | undefined {
  let isCharacterClass = false;

  for (let index = start + 1; index < line.length; index++) {
    const char = line[index];

    if (char === '\\') {
      index++;
      continue;
    }

    if (char === '[') {
      isCharacterClass = true;
      continue;
    }

    if (char === ']' && isCharacterClass) {
      isCharacterClass = false;
      continue;
    }

    if (char === '/' && !isCharacterClass) {
      return findJavaScriptRegexFlagsEnd(line, index);
    }
  }

  return undefined;
}

function isJavaScriptIdentifierStart(
  value: string | undefined,
): value is string {
  return value !== undefined && /[A-Za-z_$]/.test(value);
}

function findJavaScriptIdentifierEnd(line: string, start: number): number {
  let end = start + 1;

  while (end < line.length && isJavaScriptIdentifierPart(line[end])) {
    end++;
  }

  return end;
}

function isJavaScriptNumberStart(value: string | undefined): boolean {
  return value !== undefined && /[0-9]/.test(value);
}

function isJavaScriptRegexAllowedAfterKeyword(token: string): boolean {
  return (
    token === 'case' ||
    token === 'delete' ||
    token === 'instanceof' ||
    token === 'return' ||
    token === 'throw' ||
    token === 'typeof' ||
    token === 'void' ||
    token === 'yield'
  );
}

function isJavaScriptRegexAllowedAfterPunctuation(char: string): boolean {
  return /[!%&(*+,\-.:;<=>?[\\^{|~]/.test(char);
}

function isJavaScriptQuote(
  value: string | undefined,
): value is JavaScriptQuote {
  return value === '"' || value === "'" || value === '`';
}

function assertValidScanOffsets(
  text: string,
  startOffset: ScanTextOffset,
  endOffset: ScanTextOffset,
): void {
  if (startOffset > endOffset || endOffset > text.length) {
    throw new Error(
      `Invalid JavaScript-like scan range "${String(startOffset)}..${String(
        endOffset,
      )}" — expected offsets inside the text.`,
    );
  }
}

function findJavaScriptLineEnd(
  text: string,
  start: ScanTextOffset,
  end: ScanTextOffset,
): ScanTextOffset {
  for (let index = start + 2; index < end; index++) {
    if (text[index] === '\n') {
      return toScanTextOffset(index);
    }
  }

  return toScanTextOffset(end - 1);
}

function findJavaScriptRegexFlagsEnd(line: string, regexEnd: number): number {
  let end = regexEnd;

  for (let index = regexEnd + 1; index < line.length; index++) {
    if (!isJavaScriptIdentifierPart(line[index])) {
      break;
    }

    end = index;
  }

  return end;
}

function isJavaScriptIdentifierPart(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_$]/.test(value);
}
