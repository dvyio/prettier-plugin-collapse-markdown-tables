import { expect, test } from 'vitest';

import { mapPrettierRangeStateToMarkdown } from '../src/prettierRangeState.js';

test('given Prettier moves selected text between lines without changing the line count, when mapping the range, then follows the text across lines', () => {
  const original = ['alpha beta gamma', 'delta', ''].join('\n');
  const formatted = ['alpha beta', 'gamma delta', ''].join('\n');
  const selectedText = 'mm';
  const options = {
    rangeEnd: original.indexOf(selectedText) + selectedText.length,
    rangeStart: original.indexOf(selectedText),
  };

  expect(mapPrettierRangeStateToMarkdown(options, original, formatted)).toEqual(
    {
      rangeEnd: formatted.indexOf(selectedText) + selectedText.length,
      rangeStart: formatted.indexOf(selectedText),
    },
  );
});
