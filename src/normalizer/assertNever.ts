/**
 * @fileoverview Fails loudly when union handling misses a case.
 */

/**
 * Throws when TypeScript expected a union to be fully handled.
 *
 * @param value - value that should have been narrowed to `never`.
 * @throws Error when a new union case reaches an old branch.
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected union value ${describeUnexpectedValue(value)}.`);
}

function describeUnexpectedValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return `"${value}"`;
  }

  return typeof value;
}
