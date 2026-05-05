/**
 * @fileoverview Renders normalized Markdown table rows and checks semantics.
 */

import type { MarkdownTableStyle } from './publicTypes.js';
import type {
  ColumnCount,
  MarkdownTableBlock,
  NormalizedTableRow,
  ParsedTableRow,
  TableRowPrefix,
} from './types.js';

import { assertNever } from './assertNever.js';
import { isMarkdownEscapedCharacter } from './lineUtils.js';
import { repairBrokenCells } from './tableRepair.js';
import {
  getValidTableColumnCount,
  hasCompatibleTableRowPrefix,
  parsePipedRow,
  scanCodeSpans,
} from './tableRows.js';

function normalizeCellContent(cell: string): string {
  const codeSpans = scanCodeSpans(cell);
  let result = '';
  let codeSpanIndex = 0;
  let index = 0;

  while (index < cell.length) {
    const char = cell[index];

    if (char === undefined) {
      break;
    }

    while (codeSpanIndex < codeSpans.spans.length) {
      const nextCodeSpan = codeSpans.spans[codeSpanIndex];

      if (nextCodeSpan === undefined || nextCodeSpan.end > index) {
        break;
      }

      codeSpanIndex++;
    }

    const codeSpan = codeSpans.spans[codeSpanIndex];
    const isInCodeSpan =
      codeSpan !== undefined && index >= codeSpan.start && index < codeSpan.end;

    if (
      !isInCodeSpan &&
      char === '|' &&
      !isMarkdownEscapedCharacter(cell, index)
    ) {
      result += '\\|';
      index++;
      continue;
    }

    result += char;
    index++;
  }

  return result;
}

function normalizeColumnCount(
  cells: ReadonlyArray<string>,
  expectedColumns: ColumnCount,
): ReadonlyArray<string> {
  const normalized = cells.slice(0, expectedColumns);

  while (normalized.length < expectedColumns) {
    normalized.push('');
  }

  return normalized;
}

function renderTableRow(
  prefix: TableRowPrefix,
  cells: ReadonlyArray<string>,
  tableStyle: Exclude<MarkdownTableStyle, 'prettier'>,
): string {
  const normalized = cells.map((cell) => normalizeCellContent(cell).trim());

  switch (tableStyle) {
    case 'compact':
      return `${prefix}|${normalized.join('|')}|`;

    case 'spaced':
      return `${prefix}| ${normalized.join(' | ')} |`;

    default:
      return assertNever(tableStyle);
  }
}

function renderSeparatorCell(
  cell: string,
  tableStyle: Exclude<MarkdownTableStyle, 'prettier'>,
): string {
  const left = cell.startsWith(':') ? ':' : '';
  const right = cell.endsWith(':') ? ':' : '';
  const separator = `${left}---${right}`;

  switch (tableStyle) {
    case 'compact':
      return separator;

    case 'spaced':
      return ` ${separator} `;

    default:
      return assertNever(tableStyle);
  }
}

function rebuildSeparatorRow(
  prefix: TableRowPrefix,
  row: ParsedTableRow,
  expectedColumns: ColumnCount,
  tableStyle: Exclude<MarkdownTableStyle, 'prettier'>,
): string {
  const raw = row.fragments.map((cell) => cell.trim());

  const cells = raw
    .slice(0, expectedColumns)
    .map((cell) => renderSeparatorCell(cell, tableStyle));

  while (cells.length < expectedColumns) {
    cells.push(renderSeparatorCell('---', tableStyle));
  }

  return `${prefix}|${cells.join('|')}|`;
}

/**
 * Normalizes one Markdown table block and returns the original block when the rewrite would change its meaning.
 */
export function normalizeTableBlock(
  block: MarkdownTableBlock,
  tableStyle: Exclude<MarkdownTableStyle, 'prettier'>,
): ReadonlyArray<string> {
  const rows = block.rows;

  const header = rows[0];

  if (header === undefined) {
    return block.lines;
  }

  if (
    !rows.every((row) => hasCompatibleTableRowPrefix(header.prefix, row.prefix))
  ) {
    return block.lines;
  }

  const separator = rows[1];

  if (separator === undefined) {
    return block.lines;
  }

  const expectedColumns = getValidTableColumnCount(header, separator);

  if (expectedColumns === undefined) {
    return block.lines;
  }

  const normalizedRows: Array<NormalizedTableRow> = [];

  for (let index = 0; index < block.lines.length; index++) {
    const line = block.lines[index];
    const row = rows[index];

    if (line === undefined || row === undefined) {
      if (line !== undefined) {
        normalizedRows.push({ line, status: 'preserved' });
      }

      continue;
    }

    if (index === 1) {
      normalizedRows.push({
        line: rebuildSeparatorRow(
          header.prefix,
          row,
          expectedColumns,
          tableStyle,
        ),
        status: 'separator',
      });
      continue;
    }

    if (row.balanced && row.cells.length <= expectedColumns) {
      const cells = normalizeColumnCount(row.cells, expectedColumns);

      normalizedRows.push({
        cells,
        line: renderTableRow(header.prefix, cells, tableStyle),
        status: 'normalized',
      });
      continue;
    }

    const repair = repairBrokenCells(row, expectedColumns);

    switch (repair.status) {
      case 'failed':
        normalizedRows.push({ line, status: 'preserved' });
        continue;

      case 'repaired': {
        const cells = normalizeColumnCount(repair.cells, expectedColumns);

        normalizedRows.push({
          cells,
          line: renderTableRow(header.prefix, cells, tableStyle),
          status: 'repaired',
        });
        continue;
      }

      default:
        assertNever(repair);
    }
  }

  if (!hasSafeNormalizedTableSemantics(rows, normalizedRows, expectedColumns)) {
    return block.lines;
  }

  return normalizedRows.map((row) => row.line);
}

function hasSafeNormalizedTableSemantics(
  originalRows: ReadonlyArray<ParsedTableRow>,
  normalizedRows: ReadonlyArray<NormalizedTableRow>,
  expectedColumns: ColumnCount,
): boolean {
  const originalSeparator = originalRows[1];
  const normalizedSeparator = normalizedRows[1];

  if (
    originalRows.length !== normalizedRows.length ||
    originalSeparator === undefined ||
    normalizedSeparator?.status !== 'separator'
  ) {
    return false;
  }

  const parsedSeparator = parsePipedRow(normalizedSeparator.line);

  if (
    parsedSeparator === undefined ||
    !haveSameSeparatorSemantics(
      originalSeparator,
      parsedSeparator,
      expectedColumns,
    )
  ) {
    return false;
  }

  for (let index = 0; index < normalizedRows.length; index++) {
    const normalizedRow = normalizedRows[index];

    if (normalizedRow === undefined) {
      continue;
    }

    switch (normalizedRow.status) {
      case 'preserved':
      case 'separator':
        continue;

      case 'normalized':
      case 'repaired': {
        const parsedRow = parsePipedRow(normalizedRow.line);

        if (
          parsedRow === undefined ||
          !haveSameCellSemantics(normalizedRow.cells, parsedRow.cells)
        ) {
          return false;
        }

        continue;
      }

      default:
        return assertNever(normalizedRow);
    }
  }

  return true;
}

function haveSameSeparatorSemantics(
  original: ParsedTableRow,
  normalized: ParsedTableRow,
  expectedColumns: ColumnCount,
): boolean {
  const originalCells = original.fragments.slice(0, expectedColumns);
  const normalizedCells = normalized.fragments.slice(0, expectedColumns);

  if (originalCells.length !== normalizedCells.length) {
    return false;
  }

  return originalCells.every((cell, index) => {
    const normalizedCell = normalizedCells[index];

    return (
      normalizedCell !== undefined &&
      getSeparatorAlignment(cell) === getSeparatorAlignment(normalizedCell)
    );
  });
}

function getSeparatorAlignment(cell: string): string {
  const trimmed = cell.trim();
  const left = trimmed.startsWith(':') ? ':' : '';
  const right = trimmed.endsWith(':') ? ':' : '';

  return `${left}${right}`;
}

function haveSameCellSemantics(
  expectedCells: ReadonlyArray<string>,
  normalizedCells: ReadonlyArray<string>,
): boolean {
  if (expectedCells.length !== normalizedCells.length) {
    return false;
  }

  return expectedCells.every((cell, index) => {
    const normalizedCell = normalizedCells[index];

    return (
      normalizedCell !== undefined &&
      getCellSemanticText(cell) === getCellSemanticText(normalizedCell)
    );
  });
}

function getCellSemanticText(cell: string): string {
  return normalizeCellContent(cell).trim();
}
