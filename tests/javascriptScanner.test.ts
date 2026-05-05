import { describe, expect, test } from 'vitest';

import { scanJavaScriptLikeText } from '../src/normalizer/javascriptScanner.js';
import { toScanTextOffset } from '../src/normalizer/lineUtils.js';

type JavaScriptLikeLineCommentBehavior = 'skip-to-line-end' | 'stop';

describe('javascriptScanner', () => {
  test('given strings and regexes contain line-comment text, when scanning, then it stops at the real line comment', () => {
    const text = String.raw`const url = "https://example.com"; const pattern = /\/\//g; // real`;
    const result = scanJavaScriptLikeText(
      text,
      {
        canStartRegex: true,
        isBlockComment: false,
        quote: undefined,
      },
      {
        lineCommentBehavior: 'stop',
      },
    );

    expect(result.stopReason).toBe('line-comment');
    expect(text.slice(result.stopOffset)).toBe('// real');
  });

  test('given regexes, comments, and strings contain braces, when scanning, then it stops at the real closing brace', () => {
    const text = String.raw`{ const pattern = /[}/]\//; const label = "}"; /* } */ value } trailing`;
    const result = scanBraceExpression(text, 'stop');

    expect(result.stopReason).toBe('callback');
    expect(result.stopOffset).toBe(text.indexOf(' trailing'));
  });

  test('given a line comment contains a brace, when skipping line comments, then it closes on the later real brace', () => {
    const text = ['{ // }', 'value } trailing'].join('\n');
    const result = scanBraceExpression(text, 'skip-to-line-end');

    expect(result.stopReason).toBe('callback');
    expect(result.stopOffset).toBe(text.indexOf(' trailing'));
  });
});

function scanBraceExpression(
  text: string,
  lineCommentBehavior: JavaScriptLikeLineCommentBehavior,
) {
  let braceDepth = 0;

  return scanJavaScriptLikeText(
    text,
    {
      canStartRegex: true,
      isBlockComment: false,
      quote: undefined,
    },
    {
      lineCommentBehavior,
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
    },
  );
}
