// SPDX-License-Identifier: GPL-3.0-or-later

import {
  getLineEnd,
  getLineStart,
  isEscaped,
  isInsideFencedCode,
  isInsideInlineCode
} from "./editor-context.js";

function parseTableRow(line) {
  const firstContent = line.search(/\S/);
  if (firstContent === -1 || line[firstContent] !== "|") return null;

  let lastContent = line.length - 1;
  while (lastContent >= 0 && /[ \t]/.test(line[lastContent])) lastContent -= 1;
  if (line[lastContent] !== "|") return null;

  const pipes = [];
  for (let index = firstContent; index <= lastContent; index += 1) {
    if (line[index] === "|" && !isEscaped(line, index)) pipes.push(index);
  }
  if (pipes.length < 3) return null;

  return {
    cells: pipes.slice(0, -1).map((pipe, index) => ({
      start: pipe + 1,
      end: pipes[index + 1]
    })),
    indentation: line.slice(0, firstContent)
  };
}

function isSeparatorRow(line) {
  const row = parseTableRow(line);
  return Boolean(row && row.cells.every(({ start, end }) => (
    /^:?-{3,}:?$/.test(line.slice(start, end).trim())
  )));
}

function getLine(value, lineStart) {
  return value.slice(lineStart, getLineEnd(value, lineStart));
}

function getPreviousLineStart(value, lineStart) {
  return lineStart === 0 ? -1 : getLineStart(value, lineStart - 1);
}

function getNextLineStart(value, lineStart) {
  const lineEnd = getLineEnd(value, lineStart);
  return lineEnd === value.length ? -1 : lineEnd + 1;
}

function isTableContext(value, lineStart) {
  let candidateStart = lineStart;
  while (candidateStart >= 0) {
    const line = getLine(value, candidateStart);
    if (!parseTableRow(line)) break;
    if (isSeparatorRow(line)) return true;
    candidateStart = getPreviousLineStart(value, candidateStart);
  }

  candidateStart = getNextLineStart(value, lineStart);
  while (candidateStart >= 0) {
    const line = getLine(value, candidateStart);
    if (!parseTableRow(line)) break;
    if (isSeparatorRow(line)) return true;
    candidateStart = getNextLineStart(value, candidateStart);
  }

  return false;
}

function hasSeparatorBefore(value, lineStart) {
  let candidateStart = getPreviousLineStart(value, lineStart);
  while (candidateStart >= 0) {
    const line = getLine(value, candidateStart);
    if (!parseTableRow(line)) return false;
    if (isSeparatorRow(line)) return true;
    candidateStart = getPreviousLineStart(value, candidateStart);
  }
  return false;
}

function makeRow(indentation, cellCount, separator = false) {
  const cell = separator ? "---" : "";
  return `${indentation}| ${Array(cellCount).fill(cell).join(" | ")} |`;
}

function getCellCursor(lineStart, cell) {
  return lineStart + cell.start + 1;
}

function isEmptyRow(line, row) {
  return row.cells.every(({ start, end }) => !line.slice(start, end).trim());
}

function getTableExitEdit(value, lineStart, lineEnd) {
  let nextValue = value.slice(0, lineStart) + value.slice(lineEnd);
  if (lineStart > 0 && lineStart === nextValue.length && nextValue.endsWith("\n")) {
    nextValue += "\n";
  }
  return {
    value: nextValue,
    selectionStart: lineStart,
    selectionEnd: lineStart
  };
}

export function getTableEnterEdit(value, selectionStart, selectionEnd) {
  if (selectionStart !== selectionEnd || isInsideFencedCode(value, selectionStart)) return null;

  const lineStart = getLineStart(value, selectionStart);
  const lineEnd = getLineEnd(value, selectionStart);
  const line = value.slice(lineStart, lineEnd);
  const row = parseTableRow(line);
  if (!row) return null;

  const nextStart = getNextLineStart(value, lineStart);
  if (!isTableContext(value, lineStart)) {
    if (selectionStart !== lineEnd) return null;
    if (nextStart >= 0 && isSeparatorRow(getLine(value, nextStart))) return null;

    const separator = makeRow(row.indentation, row.cells.length, true);
    const dataRow = makeRow(row.indentation, row.cells.length);
    const insertion = `\n${separator}\n${dataRow}`;
    const cursor = selectionStart + separator.length + 4 + row.indentation.length;
    return {
      value: value.slice(0, selectionStart) + insertion + value.slice(selectionStart),
      selectionStart: cursor,
      selectionEnd: cursor
    };
  }

  if (isSeparatorRow(line)) return null;
  if (!hasSeparatorBefore(value, lineStart)) return null;
  if (isEmptyRow(line, row)) return getTableExitEdit(value, lineStart, lineEnd);

  const positionInLine = selectionStart - lineStart;
  const lastCell = row.cells[row.cells.length - 1];
  const isInLastCell = positionInLine >= lastCell.start && positionInLine <= lastCell.end;
  if (!isInLastCell && selectionStart !== lineEnd) return null;

  const newRow = makeRow(row.indentation, row.cells.length);
  const insertion = `\n${newRow}`;
  const cursor = lineEnd + 3 + row.indentation.length;
  return {
    value: value.slice(0, lineEnd) + insertion + value.slice(lineEnd),
    selectionStart: cursor,
    selectionEnd: cursor
  };
}

export function getTableBackspaceEdit(value, selectionStart, selectionEnd) {
  if (
    selectionStart !== selectionEnd ||
    isInsideFencedCode(value, selectionStart) ||
    isInsideInlineCode(value, selectionStart)
  ) return null;

  const lineStart = getLineStart(value, selectionStart);
  const lineEnd = getLineEnd(value, selectionStart);
  const line = value.slice(lineStart, lineEnd);
  const row = parseTableRow(line);
  if (
    !row ||
    !isTableContext(value, lineStart) ||
    !hasSeparatorBefore(value, lineStart) ||
    !isEmptyRow(line, row) ||
    selectionStart !== getCellCursor(lineStart, row.cells[0])
  ) return null;

  return getTableExitEdit(value, lineStart, lineEnd);
}

function findAdjacentTableCell(value, lineStart, backwards) {
  let adjacentStart = backwards
    ? getPreviousLineStart(value, lineStart)
    : getNextLineStart(value, lineStart);

  while (adjacentStart >= 0) {
    const line = getLine(value, adjacentStart);
    const row = parseTableRow(line);
    if (!row) return null;
    if (!isSeparatorRow(line)) {
      const cell = backwards ? row.cells[row.cells.length - 1] : row.cells[0];
      return getCellCursor(adjacentStart, cell);
    }
    adjacentStart = backwards
      ? getPreviousLineStart(value, adjacentStart)
      : getNextLineStart(value, adjacentStart);
  }

  return null;
}

export function getTableTabEdit(value, selectionStart, selectionEnd, backwards = false) {
  if (
    selectionStart !== selectionEnd ||
    isInsideFencedCode(value, selectionStart) ||
    isInsideInlineCode(value, selectionStart)
  ) return null;

  const lineStart = getLineStart(value, selectionStart);
  const line = getLine(value, lineStart);
  const row = parseTableRow(line);
  if (!row || !isTableContext(value, lineStart) || isSeparatorRow(line)) return null;

  const positionInLine = selectionStart - lineStart;
  const cellIndex = row.cells.findIndex(({ start, end }) => (
    positionInLine >= start && positionInLine <= end
  ));
  if (cellIndex === -1) return null;

  const adjacentIndex = cellIndex + (backwards ? -1 : 1);
  if (adjacentIndex >= 0 && adjacentIndex < row.cells.length) {
    const cursor = getCellCursor(lineStart, row.cells[adjacentIndex]);
    return { value, selectionStart: cursor, selectionEnd: cursor };
  }

  const adjacentCursor = findAdjacentTableCell(value, lineStart, backwards);
  if (adjacentCursor !== null) {
    return { value, selectionStart: adjacentCursor, selectionEnd: adjacentCursor };
  }
  if (backwards) return null;

  let insertionStart = getLineEnd(value, lineStart);
  let nextStart = getNextLineStart(value, lineStart);
  if (nextStart >= 0 && isSeparatorRow(getLine(value, nextStart))) {
    insertionStart = getLineEnd(value, nextStart);
  }
  const newRow = makeRow(row.indentation, row.cells.length);
  const insertion = `\n${newRow}`;
  const cursor = insertionStart + 3 + row.indentation.length;
  return {
    value: value.slice(0, insertionStart) + insertion + value.slice(insertionStart),
    selectionStart: cursor,
    selectionEnd: cursor
  };
}
