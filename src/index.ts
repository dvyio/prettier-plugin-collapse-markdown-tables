/**
 * @fileoverview Adds readable Markdown table styles to Prettier's Markdown printer.
 */

import type {
  AstPath,
  Doc,
  Parser,
  ParserOptions,
  Plugin,
  Printer,
  SupportOptions,
} from 'prettier';

import { builders, printer as docPrinter } from 'prettier/doc';
import * as prettierMarkdownPlugin from 'prettier/plugins/markdown';

import {
  type MarkdownTableStyle,
  normalizeMarkdownTables,
} from './normalizeMarkdownTables.js';
import {
  DEFAULT_MARKDOWN_TABLE_STYLE,
  MARKDOWN_TABLE_STYLE_OPTIONS,
} from './normalizer/publicTypes.js';
import { mayContainMarkdownTableCandidate } from './normalizer/tableRows.js';
import {
  getPreprocessedNormalizeOptions,
  getPrintedNormalizeOptions,
  isPartialMarkdownPluginRangeFormat,
  readMarkdownPluginOptions,
} from './prettierMarkdownOptions.js';
import {
  forgetPreprocessedMarkdown,
  readKnownMarkdownSource,
  remapPrettierRangeStateAfterPreprocess,
  rememberPreprocessedMarkdown,
} from './prettierRangeState.js';

export { normalizeMarkdownTables };
export type {
  MarkdownTableStyle,
  NormalizeMarkdownTablesOptions,
  ParsedMarkdownTableRow,
  TableRowPrefix,
} from './normalizeMarkdownTables.js';

declare module 'prettier' {
  interface Options {
    /** Markdown table style used by @dvyio/prettier-plugin-collapse-markdown-tables. */
    readonly markdownTableStyle?: MarkdownTableStyle;
  }
}

type MarkdownNode = {
  readonly children?: ReadonlyArray<MarkdownNode>;
  readonly type?: string;
};

type MarkdownParserName = 'markdown' | 'mdx' | 'remark';

const { printDocToString } = docPrinter;
const { hardline, join } = builders;

const PREPROCESS_ERROR_MESSAGE =
  'Could not preprocess Markdown before table normalization.';

const originalPrinter: Printer<MarkdownNode> =
  prettierMarkdownPlugin.printers.mdast;

const parsers: Record<MarkdownParserName, Parser<MarkdownNode>> = {
  markdown: withRangeTableNormalization(
    prettierMarkdownPlugin.parsers.markdown,
    false,
    false,
  ),
  mdx: withRangeTableNormalization(
    prettierMarkdownPlugin.parsers.mdx,
    true,
    true,
  ),
  remark: withRangeTableNormalization(
    prettierMarkdownPlugin.parsers.remark,
    false,
    false,
  ),
};

const pluginOptions: SupportOptions = {
  markdownTableStyle: {
    category: 'Markdown',
    choices: MARKDOWN_TABLE_STYLE_OPTIONS.map(({ description, value }) => ({
      description,
      value,
    })),
    default: DEFAULT_MARKDOWN_TABLE_STYLE,
    description: 'Markdown table formatting style.',
    type: 'choice',
  },
};

const printers: Record<'mdast', Printer<MarkdownNode>> = {
  mdast: {
    ...originalPrinter,
    print(
      path: AstPath<MarkdownNode>,
      options: ParserOptions<MarkdownNode>,
      print: (path: AstPath<MarkdownNode>) => Doc,
      args?: unknown,
    ): Doc {
      const printed = originalPrinter.print(path, options, print, args);

      if (!path.isRoot || path.node.type !== 'root') {
        return printed;
      }

      const pluginOptions = readMarkdownPluginOptions(options);

      if (pluginOptions.parentParser !== undefined) {
        forgetPreprocessedMarkdown(options);
        return printed;
      }

      if (pluginOptions.markdownTableStyle === 'prettier') {
        forgetPreprocessedMarkdown(options);
        return printed;
      }

      if (!hasMarkdownTableNode(path.node)) {
        forgetPreprocessedMarkdown(options);
        return printed;
      }

      return normalizePrintedMarkdownThroughAdapter(printed, options);
    },
  },
};

function normalizePrintedMarkdownThroughAdapter(
  printed: Doc,
  options: ParserOptions<MarkdownNode>,
): Doc {
  const pluginOptions = readMarkdownPluginOptions(options);

  try {
    if (!sourceMayContainMarkdownTable(options)) {
      return printed;
    }

    const { formatted } = printDocToString(printed, options);

    if (!mayContainMarkdownTableCandidate(formatted)) {
      return printed;
    }

    const normalizeOptions = getPrintedNormalizeOptions(
      options,
      pluginOptions,
      formatted,
      pluginOptions.parser === 'mdx',
      pluginOptions.parser === 'mdx',
    );
    const normalized = normalizeMarkdownTables(formatted, normalizeOptions);

    if (normalized === formatted) {
      return printed;
    }

    return markdownToDoc(normalized);
  } finally {
    forgetPreprocessedMarkdown(options);
  }
}

function hasMarkdownTableNode(node: MarkdownNode): boolean {
  if (node.type === 'table') {
    return true;
  }

  for (const child of node.children ?? []) {
    if (hasMarkdownTableNode(child)) {
      return true;
    }
  }

  return false;
}

function sourceMayContainMarkdownTable(
  options: ParserOptions<MarkdownNode>,
): boolean {
  const source = readKnownMarkdownSource(options);

  return source === undefined || mayContainMarkdownTableCandidate(source);
}

function markdownToDoc(markdown: string): Doc {
  const lines = markdown.split(/\r\n|\n|\r/);

  return join(hardline, lines);
}

function withRangeTableNormalization(
  parser: Parser<MarkdownNode>,
  enableMdxEsm: boolean,
  enableMdxJsx: boolean,
): Parser<MarkdownNode> {
  return {
    ...parser,
    preprocess(text, options) {
      let preprocessedMarkdown: unknown = text;

      try {
        if (parser.preprocess !== undefined) {
          preprocessedMarkdown = parser.preprocess(text, options);
        }
      } catch (cause) {
        throw createPreprocessError(cause);
      }

      if (isPromiseLike(preprocessedMarkdown)) {
        return normalizeAsyncPreprocessedMarkdown(
          preprocessedMarkdown,
          options,
          enableMdxEsm,
          enableMdxJsx,
        );
      }

      return normalizePreprocessedMarkdown(
        preprocessedMarkdown,
        options,
        enableMdxEsm,
        enableMdxJsx,
      );
    },
  };
}

async function normalizeAsyncPreprocessedMarkdown(
  preprocessedMarkdown: PromiseLike<unknown>,
  options: ParserOptions<MarkdownNode>,
  enableMdxEsm: boolean,
  enableMdxJsx: boolean,
): Promise<string> {
  let markdown: unknown;

  try {
    markdown = await preprocessedMarkdown;
  } catch (cause) {
    throw createPreprocessError(cause);
  }

  return normalizePreprocessedMarkdown(
    markdown,
    options,
    enableMdxEsm,
    enableMdxJsx,
  );
}

function normalizePreprocessedMarkdown(
  markdown: unknown,
  options: ParserOptions<MarkdownNode>,
  enableMdxEsm: boolean,
  enableMdxJsx: boolean,
): string {
  if (typeof markdown !== 'string') {
    throw new Error(
      `Could not normalize Markdown tables because the Markdown parser returned "${typeof markdown}" instead of Markdown text.`,
    );
  }

  return normalizeMarkdownTablesInRequestedRange(
    markdown,
    options,
    enableMdxEsm,
    enableMdxJsx,
  );
}

function createPreprocessError(cause: unknown): Error {
  return new Error(PREPROCESS_ERROR_MESSAGE, {
    cause: normalizePreprocessFailureCause(cause),
  });
}

function normalizePreprocessFailureCause(cause: unknown): Error {
  if (cause instanceof Error) {
    return cause;
  }

  return new Error(
    `Markdown parser preprocess failed with ${describePreprocessFailureCause(
      cause,
    )}.`,
  );
}

function describePreprocessFailureCause(cause: unknown): string {
  if (cause === undefined) {
    return 'undefined';
  }

  if (cause === null) {
    return 'null';
  }

  if (typeof cause === 'string') {
    return `"${cause}"`;
  }

  if (
    typeof cause === 'number' ||
    typeof cause === 'boolean' ||
    typeof cause === 'bigint'
  ) {
    return `${cause}`;
  }

  if (typeof cause === 'symbol') {
    const description = cause.description;

    if (description === undefined) {
      return 'a symbol';
    }

    return `symbol "${description}"`;
  }

  if (typeof cause === 'function') {
    return 'a function';
  }

  return 'an object';
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null
  ) {
    return false;
  }

  return 'then' in value && typeof value.then === 'function';
}

function normalizeMarkdownTablesInRequestedRange(
  markdown: string,
  options: ParserOptions<MarkdownNode>,
  enableMdxEsm: boolean,
  enableMdxJsx: boolean,
): string {
  const pluginOptions = readMarkdownPluginOptions(options, markdown.length);

  if (
    pluginOptions.parentParser !== undefined ||
    pluginOptions.markdownTableStyle === 'prettier' ||
    !mayContainMarkdownTableCandidate(markdown) ||
    !isPartialMarkdownPluginRangeFormat(pluginOptions, markdown.length)
  ) {
    return markdown;
  }

  const normalized = normalizeMarkdownTables(
    markdown,
    getPreprocessedNormalizeOptions(
      pluginOptions,
      markdown,
      enableMdxEsm,
      enableMdxJsx,
    ),
  );

  remapPrettierRangeStateAfterPreprocess(options, markdown, normalized);
  rememberPreprocessedMarkdown(options, markdown, normalized);

  return normalized;
}

/**
 * Adds `markdownTableStyle` to Prettier's Markdown, MDX, and remark parsers.
 */
const plugin: Plugin<MarkdownNode> = {
  options: pluginOptions,
  parsers,
  printers,
};

/** Prettier plugin that collapses Markdown table padding after Prettier prints Markdown. */
export default plugin;
