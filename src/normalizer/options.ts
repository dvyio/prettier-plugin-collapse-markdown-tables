/**
 * @fileoverview Reads and checks options passed to the Markdown table normalizer.
 */

import type { UncheckedNormalizeMarkdownTablesOptions } from './types.js';

import {
  DEFAULT_MARKDOWN_TABLE_FENCED_CODE,
  DEFAULT_MARKDOWN_TABLE_STYLE,
  MARKDOWN_TABLE_FENCED_CODE_OPTIONS,
  MARKDOWN_TABLE_STYLE_OPTIONS,
  type MarkdownTableFencedCode,
  type MarkdownTableStyle,
} from './publicTypes.js';

const NORMALIZE_MARKDOWN_TABLES_OPTION_KEYS = [
  'enableMdxEsm',
  'enableMdxJsx',
  'markdownTableFencedCode',
  'markdownTableStyle',
  'maxInputBytes',
  'rangeEnd',
  'rangeStart',
] as const;
const NORMALIZE_MARKDOWN_TABLES_OPTION_KEYS_LABEL =
  '"enableMdxEsm", "enableMdxJsx", "markdownTableFencedCode", "markdownTableStyle", "maxInputBytes", "rangeEnd", or "rangeStart"';
const MARKDOWN_TABLE_FENCED_CODE_VALUES_LABEL = formatOptionValuesLabel(
  MARKDOWN_TABLE_FENCED_CODE_OPTIONS,
);
const MARKDOWN_TABLE_STYLE_VALUES_LABEL = formatOptionValuesLabel(
  MARKDOWN_TABLE_STYLE_OPTIONS,
);

type NormalizeMarkdownTablesOptionKey =
  (typeof NORMALIZE_MARKDOWN_TABLES_OPTION_KEYS)[number];

function formatOptionValuesLabel(
  options: ReadonlyArray<{ readonly value: string }>,
): string {
  const quotedValues = options.map(({ value }) => `"${value}"`);
  let label = '';

  for (const [index, value] of quotedValues.entries()) {
    if (index === 0) {
      label = value;
      continue;
    }

    if (index === quotedValues.length - 1) {
      const separator = quotedValues.length === 2 ? ' or ' : ', or ';
      label = `${label}${separator}${value}`;
      continue;
    }

    label = `${label}, ${value}`;
  }

  return label;
}

/**
 * Reads helper options from unknown caller input without running getters.
 *
 * @param value - options passed to `normalizeMarkdownTables`, or `undefined`.
 * @returns unchecked option values for the later style, size, and range checks.
 * @throws Error when the value is not an object or contains an unknown key.
 */
export function readNormalizeMarkdownTablesOptions(
  value: unknown,
): UncheckedNormalizeMarkdownTablesOptions {
  if (value === undefined) {
    return {};
  }

  if (!isNormalizeMarkdownTablesOptionsRecord(value)) {
    throw new Error(
      `Invalid normalizeMarkdownTables options "${describeUnknownValue(
        value,
      )}" - expected an object or undefined.`,
    );
  }

  assertKnownNormalizeOptionKeys(value);

  return {
    enableMdxEsm: readBooleanNormalizeOption(value, 'enableMdxEsm'),
    enableMdxJsx: readBooleanNormalizeOption(value, 'enableMdxJsx'),
    markdownTableFencedCode: readOwnDataOption(
      value,
      'markdownTableFencedCode',
    ),
    markdownTableStyle: readOwnDataOption(value, 'markdownTableStyle'),
    maxInputBytes: readMaxInputBytesOption(value),
    rangeEnd: readOwnDataOption(value, 'rangeEnd'),
    rangeStart: readOwnDataOption(value, 'rangeStart'),
  };
}

function assertKnownNormalizeOptionKeys(
  options: Readonly<Record<string, unknown>>,
): void {
  for (const key of Object.getOwnPropertyNames(options)) {
    if (isNormalizeOptionKey(key)) {
      continue;
    }

    throw new Error(
      `Invalid normalizeMarkdownTables option "${key}" - expected one of ${NORMALIZE_MARKDOWN_TABLES_OPTION_KEYS_LABEL}.`,
    );
  }

  for (const symbol of Object.getOwnPropertySymbols(options)) {
    throw new Error(
      `Invalid normalizeMarkdownTables option "${String(
        symbol,
      )}" - expected one of ${NORMALIZE_MARKDOWN_TABLES_OPTION_KEYS_LABEL}.`,
    );
  }
}

function isNormalizeOptionKey(
  value: string,
): value is NormalizeMarkdownTablesOptionKey {
  return NORMALIZE_MARKDOWN_TABLES_OPTION_KEYS.some((key) => key === value);
}

function readBooleanNormalizeOption(
  options: Readonly<Record<string, unknown>>,
  key: 'enableMdxEsm' | 'enableMdxJsx',
): boolean | undefined {
  const value = readOwnDataOption(options, key);

  if (value === undefined || typeof value === 'boolean') {
    return value;
  }

  throw new Error(
    `Invalid ${key} "${describeUnknownValue(
      value,
    )}" — expected a boolean or undefined.`,
  );
}

function readMaxInputBytesOption(
  options: Readonly<Record<string, unknown>>,
): number | undefined {
  const value = readOwnDataOption(options, 'maxInputBytes');

  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }

  throw new Error(
    `Invalid maxInputBytes "${describeUnknownValue(
      value,
    )}" — expected a safe whole number at or above 0, or undefined.`,
  );
}

function isNormalizeMarkdownTablesOptionsRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Returns the requested fenced-code behavior, defaulting to `protected` when no option is set.
 *
 * @param value - raw `markdownTableFencedCode` option value.
 * @returns the checked fenced-code behavior to use.
 * @throws Error when the value is not one of the supported fenced-code choices.
 */
export function parseMarkdownTableFencedCode(
  value: unknown,
): MarkdownTableFencedCode {
  if (value === undefined) {
    return DEFAULT_MARKDOWN_TABLE_FENCED_CODE;
  }

  if (isMarkdownTableFencedCode(value)) {
    return value;
  }

  throw new Error(
    `Invalid markdownTableFencedCode "${describeUnknownValue(
      value,
    )}" — expected ${MARKDOWN_TABLE_FENCED_CODE_VALUES_LABEL}.`,
  );
}

function isMarkdownTableFencedCode(
  value: unknown,
): value is MarkdownTableFencedCode {
  return MARKDOWN_TABLE_FENCED_CODE_OPTIONS.some(
    (option) => option.value === value,
  );
}

/**
 * Returns the requested table style, defaulting to `spaced` when no style is set.
 *
 * @param value - raw `markdownTableStyle` option value.
 * @returns the checked table style to use.
 * @throws Error when the value is not one of the supported table styles.
 */
export function parseMarkdownTableStyle(value: unknown): MarkdownTableStyle {
  if (value === undefined) {
    return DEFAULT_MARKDOWN_TABLE_STYLE;
  }

  if (isMarkdownTableStyle(value)) {
    return value;
  }

  throw new Error(
    `Invalid markdownTableStyle "${describeUnknownValue(
      value,
    )}" — expected ${MARKDOWN_TABLE_STYLE_VALUES_LABEL}.`,
  );
}

function isMarkdownTableStyle(value: unknown): value is MarkdownTableStyle {
  return MARKDOWN_TABLE_STYLE_OPTIONS.some((style) => style.value === value);
}

/**
 * Reads one own data property without invoking getters or inherited values.
 *
 * @param options - object that may contain the option.
 * @param key - property name to read.
 * @returns the property value, or `undefined` when it is missing or not a data property.
 */
export function readOwnDataOption(options: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(options, key);

  if (descriptor === undefined || !('value' in descriptor)) {
    return undefined;
  }

  return descriptor.value;
}

/**
 * Returns a safe label for an unknown value in validation errors.
 *
 * @param value - value that failed validation.
 * @returns a short label that avoids calling custom object stringifiers.
 */
export function describeUnknownValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  if (typeof value === 'object' || typeof value === 'function') {
    return typeof value;
  }

  return String(value);
}
