/**
 * @fileoverview Repairs table rows split by escaped pipes or code-span pipes.
 */

import type {
  CodeSpanRepairState,
  ColumnCount,
  ParsedTableRow,
  RepairBoundaryEvidence,
  RepairBrokenCellsResult,
  RepairFinalCellFragmentsResult,
} from './types.js';

import { assertNever } from './assertNever.js';
import { countRun, isMarkdownEscapedCharacter } from './lineUtils.js';

const MIN_PRETTIER_ESCAPED_PIPE_PADDING = 2;
const INITIAL_CODE_SPAN_REPAIR_STATE: CodeSpanRepairState = {
  openDelimiterLength: undefined,
  trailingBackslashCount: 0,
};

function scanCodeSpanRepairSegment(
  state: CodeSpanRepairState,
  segment: string,
): CodeSpanRepairState {
  let openDelimiterLength = state.openDelimiterLength;
  let trailingBackslashCount = state.trailingBackslashCount;

  for (let index = 0; index < segment.length; ) {
    const char = segment[index];

    if (char === undefined) {
      break;
    }

    if (char === '`') {
      const delimiterLength = countRun(segment, index, '`');
      const isEscaped = trailingBackslashCount % 2 === 1;

      if (openDelimiterLength === undefined) {
        if (!isEscaped) {
          openDelimiterLength = delimiterLength;
        }
      } else if (openDelimiterLength === delimiterLength) {
        openDelimiterLength = undefined;
      }

      trailingBackslashCount = 0;
      index += delimiterLength;
      continue;
    }

    if (char === '\\') {
      trailingBackslashCount++;
      index++;
      continue;
    }

    trailingBackslashCount = 0;
    index++;
  }

  return {
    openDelimiterLength,
    trailingBackslashCount,
  };
}

function hasOpenCodeSpanRepairState(state: CodeSpanRepairState): boolean {
  return state.openDelimiterLength !== undefined;
}

function endsWithEscapedPipe(value: string): boolean {
  const trimmed = value.trimEnd();
  const pipeIndex = trimmed.length;

  return isMarkdownEscapedCharacter(`${trimmed}|`, pipeIndex);
}

function hasPrettierEscapedPipePadding(left: string, right: string): boolean {
  return (
    countTrailingSpaces(left) >= MIN_PRETTIER_ESCAPED_PIPE_PADDING &&
    countLeadingSpaces(right) >= MIN_PRETTIER_ESCAPED_PIPE_PADDING &&
    endsWithEscapedPipe(left)
  );
}

function countLeadingSpaces(value: string): number {
  let count = 0;

  for (let index = 0; index < value.length; index++) {
    if (value[index] !== ' ') {
      break;
    }

    count++;
  }

  return count;
}

function countTrailingSpaces(value: string): number {
  let count = 0;

  for (let index = value.length - 1; index >= 0; index--) {
    if (value[index] !== ' ') {
      break;
    }

    count++;
  }

  return count;
}

function joinEscapedPipeFragments(left: string, right: string): string {
  return `${left.trimEnd()}${getEscapedPipeJoinSuffix(left, right)}`;
}

function getEscapedPipeJoinSuffix(left: string, right: string): string {
  const trimmedLeft = left.trimEnd();
  const spacesAfterPipe = countSpacesBeforeEscapedPipe(trimmedLeft);

  return `|${' '.repeat(spacesAfterPipe)}${right.trimStart()}`;
}

function countSpacesBeforeEscapedPipe(value: string): number {
  let count = 0;
  let index = value.length - 2;

  while (index >= 0 && value[index] === ' ') {
    count++;
    index--;
  }

  return count;
}

/**
 * Rejoins extra cell fragments only when escaped-pipe padding or open code spans prove the pipe was cell text.
 */
export function repairBrokenCells(
  row: ParsedTableRow,
  expectedColumns: ColumnCount,
): RepairBrokenCellsResult {
  const { fragments } = row;

  if (fragments.length <= expectedColumns) {
    return { status: 'failed' };
  }

  const extraFragments = fragments.length - expectedColumns;
  const repaired: Array<string> = [];
  let start = 0;
  let usedRepairEvidence = false;

  for (let columnIndex = 0; columnIndex < expectedColumns; columnIndex++) {
    const columnsLeft = expectedColumns - columnIndex;

    if (columnsLeft === 1) {
      const finalCell = repairFinalCellFragments(fragments.slice(start));

      if (finalCell.status === 'failed') {
        return { status: 'failed' };
      }

      if (finalCell.usedRepairEvidence) {
        usedRepairEvidence = true;
      }

      repaired.push(finalCell.cell);
      break;
    }

    let end = start;
    const firstFragment = fragments[end];

    if (firstFragment === undefined) {
      break;
    }

    let candidate = firstFragment;
    let candidateCodeSpanState = scanCodeSpanRepairSegment(
      INITIAL_CODE_SPAN_REPAIR_STATE,
      firstFragment,
    );

    while (true) {
      const remainingFragments = fragments.length - (end + 1);
      const remainingColumns = columnsLeft - 1;
      const nextFragment = fragments[end + 1];
      const hasOpenCode = hasOpenCodeSpanRepairState(candidateCodeSpanState);
      const hasEscapedPipeBoundary =
        !hasOpenCode &&
        nextFragment !== undefined &&
        hasPrettierEscapedPipePadding(candidate, nextFragment);

      const canStop =
        !hasOpenCode &&
        !hasEscapedPipeBoundary &&
        remainingFragments >= remainingColumns;

      if (canStop) {
        repaired.push(candidate);
        start = end + 1;
        break;
      }

      if (hasOpenCode || hasEscapedPipeBoundary) {
        usedRepairEvidence = true;
      }

      end++;

      if (end >= fragments.length) {
        return { status: 'failed' };
      }

      const fragment = fragments[end];

      if (fragment === undefined) {
        return { status: 'failed' };
      }

      if (hasEscapedPipeBoundary) {
        const joinedSuffix = getEscapedPipeJoinSuffix(candidate, fragment);
        candidate = joinEscapedPipeFragments(candidate, fragment);
        candidateCodeSpanState = scanCodeSpanRepairSegment(
          candidateCodeSpanState,
          joinedSuffix,
        );
        continue;
      }

      const joinedSuffix = `|${fragment}`;
      candidate += joinedSuffix;
      candidateCodeSpanState = scanCodeSpanRepairSegment(
        candidateCodeSpanState,
        joinedSuffix,
      );
    }
  }

  if (repaired.length !== expectedColumns) {
    return { status: 'failed' };
  }

  if (!usedRepairEvidence && extraFragments > 0) {
    return { status: 'failed' };
  }

  return { cells: repaired, status: 'repaired' };
}

function repairFinalCellFragments(
  fragments: ReadonlyArray<string>,
): RepairFinalCellFragmentsResult {
  const firstFragment = fragments[0];

  if (firstFragment === undefined) {
    return { status: 'failed' };
  }

  let cell = firstFragment;
  let cellCodeSpanState = scanCodeSpanRepairSegment(
    INITIAL_CODE_SPAN_REPAIR_STATE,
    firstFragment,
  );
  let usedRepairEvidence = false;

  for (let index = 1; index < fragments.length; index++) {
    const nextFragment = fragments[index];

    if (nextFragment === undefined) {
      return { status: 'failed' };
    }

    const boundaryEvidence = getRepairBoundaryEvidence(
      cell,
      nextFragment,
      cellCodeSpanState,
    );

    if (boundaryEvidence === undefined) {
      return { status: 'failed' };
    }

    usedRepairEvidence = true;

    switch (boundaryEvidence) {
      case 'escaped-pipe': {
        const joinedSuffix = getEscapedPipeJoinSuffix(cell, nextFragment);
        cell = joinEscapedPipeFragments(cell, nextFragment);
        cellCodeSpanState = scanCodeSpanRepairSegment(
          cellCodeSpanState,
          joinedSuffix,
        );
        continue;
      }

      case 'open-code-span': {
        const joinedSuffix = `|${nextFragment}`;
        cell += joinedSuffix;
        cellCodeSpanState = scanCodeSpanRepairSegment(
          cellCodeSpanState,
          joinedSuffix,
        );
        continue;
      }

      default:
        assertNever(boundaryEvidence);
    }
  }

  if (hasOpenCodeSpanRepairState(cellCodeSpanState)) {
    return { status: 'failed' };
  }

  return { cell, status: 'repaired', usedRepairEvidence };
}

function getRepairBoundaryEvidence(
  cell: string,
  nextFragment: string,
  cellCodeSpanState: CodeSpanRepairState,
): RepairBoundaryEvidence | undefined {
  if (hasOpenCodeSpanRepairState(cellCodeSpanState)) {
    return 'open-code-span';
  }

  if (hasPrettierEscapedPipePadding(cell, nextFragment)) {
    return 'escaped-pipe';
  }

  return undefined;
}
