import type { Printer } from 'prettier';

import * as prettier from 'prettier';
import { afterEach, describe, expect, test, vi } from 'vitest';

type TestMarkdownNode = {
  readonly text: string;
  readonly type: 'root';
};

type MockMarkdownParser = {
  readonly astFormat: 'mdast';
  readonly locEnd: (node: TestMarkdownNode) => number;
  readonly locStart: () => number;
  readonly parse: (text: string) => TestMarkdownNode;
  readonly preprocess: () => unknown;
};

type MockedPreprocess = () => unknown;

type RejectedThenable = {
  readonly then: (
    onFulfilled: (value: unknown) => void,
    onRejected: (reason: unknown) => void,
  ) => void;
};

const ASYNC_PREPROCESSED_MARKDOWN = [
  '| Name  | Role        |',
  '| ----- | ----------- |',
  '| Davey | Builder     |',
  '',
].join('\n');

describe('async parser preprocess support', () => {
  afterEach(() => {
    vi.doUnmock('prettier/plugins/markdown');
    vi.resetModules();
  });

  test('given async parser preprocess, when formatting, then awaits and normalizes the Markdown', async () => {
    const plugin = await loadPluginWithMockedPreprocess(() =>
      Promise.resolve(ASYNC_PREPROCESSED_MARKDOWN),
    );

    await expect(
      prettier.format('ignored by mocked preprocess', {
        parser: 'markdown',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      ['| Name | Role |', '| --- | --- |', '| Davey | Builder |', ''].join(
        '\n',
      ),
    );
  });

  test('given sync parser preprocess, when formatting, then keeps the existing normalization path', async () => {
    const plugin = await loadPluginWithMockedPreprocess(
      () => ASYNC_PREPROCESSED_MARKDOWN,
    );

    await expect(
      prettier.format('ignored by mocked preprocess', {
        parser: 'markdown',
        plugins: [plugin],
      }),
    ).resolves.toBe(
      ['| Name | Role |', '| --- | --- |', '| Davey | Builder |', ''].join(
        '\n',
      ),
    );
  });

  test('given sync parser preprocess returns an object, when formatting, then it rejects with the boundary message', async () => {
    const plugin = await loadPluginWithMockedPreprocess(() => ({}));

    await expect(
      prettier.format('ignored by mocked preprocess', {
        parser: 'markdown',
        plugins: [plugin],
      }),
    ).rejects.toThrow(
      'Could not normalize Markdown tables because the Markdown parser returned "object" instead of Markdown text.',
    );
  });

  test('given async parser preprocess resolves to an object, when formatting, then it rejects with the boundary message', async () => {
    const plugin = await loadPluginWithMockedPreprocess(() =>
      Promise.resolve({}),
    );

    await expect(
      prettier.format('ignored by mocked preprocess', {
        parser: 'markdown',
        plugins: [plugin],
      }),
    ).rejects.toThrow(
      'Could not normalize Markdown tables because the Markdown parser returned "object" instead of Markdown text.',
    );
  });

  test('given sync parser preprocess throws a string, when formatting, then it wraps the failure with an Error cause', async () => {
    const plugin = await loadPluginWithMockedPreprocess(() => {
      throwExternalParserValue('mock parser failed');
    });

    await expectFormatToRejectWithPreprocessCause(
      plugin,
      'Markdown parser preprocess failed with "mock parser failed".',
    );
  });

  test('given async parser preprocess rejects with a string, when formatting, then it wraps the failure with an Error cause', async () => {
    const plugin = await loadPluginWithMockedPreprocess(() =>
      createRejectedThenable('mock parser failed'),
    );

    await expectFormatToRejectWithPreprocessCause(
      plugin,
      'Markdown parser preprocess failed with "mock parser failed".',
    );
  });
});

async function loadPluginWithMockedPreprocess(
  preprocess: MockedPreprocess,
): Promise<prettier.Plugin> {
  vi.resetModules();
  vi.doMock('prettier/plugins/markdown', () => {
    const parser = createMockMarkdownParser(preprocess);
    const printer = createMockMarkdownPrinter();

    return {
      parsers: {
        markdown: parser,
        mdx: parser,
        remark: parser,
      },
      printers: {
        mdast: printer,
      },
    };
  });

  const pluginModule = await import('../src/index.js');

  return pluginModule.default;
}

function createMockMarkdownParser(
  preprocess: MockedPreprocess,
): MockMarkdownParser {
  return {
    astFormat: 'mdast',
    locEnd(node) {
      return node.text.length;
    },
    locStart() {
      return 0;
    },
    parse(text) {
      return {
        text,
        type: 'root',
      };
    },
    preprocess() {
      return preprocess();
    },
  };
}

function throwExternalParserValue(value: unknown): never {
  throw value;
}

function createRejectedThenable(reason: unknown): RejectedThenable {
  return {
    then(_onFulfilled, onRejected) {
      onRejected(reason);
    },
  };
}

function createMockMarkdownPrinter(): Printer<TestMarkdownNode> {
  return {
    print(path) {
      return path.node.text;
    },
  };
}

async function expectFormatToRejectWithPreprocessCause(
  plugin: prettier.Plugin,
  causeMessage: string,
): Promise<void> {
  try {
    await prettier.format('ignored by mocked preprocess', {
      parser: 'markdown',
      plugins: [plugin],
    });
  } catch (error) {
    expect(error).toBeInstanceOf(Error);

    if (!(error instanceof Error)) {
      throw new Error('Expected Prettier to throw an Error.', {
        cause: error,
      });
    }

    expect(error.message).toBe(
      'Could not preprocess Markdown before table normalization.',
    );
    expect(error.cause).toBeInstanceOf(Error);

    if (!(error.cause instanceof Error)) {
      throw new Error('Expected the preprocess failure cause to be an Error.', {
        cause: error,
      });
    }

    expect(error.cause.message).toBe(causeMessage);
    return;
  }

  throw new Error('Expected Prettier to reject.');
}
