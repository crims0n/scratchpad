// SPDX-License-Identifier: GPL-3.0-or-later

import {
  getLineEnd,
  getLineStart,
  isEscaped,
  isInsideFencedCode,
  isInsideInlineCode,
  parseListLine
} from "./editor-context.js";
import { applyEditorEdit } from "./editor-edit.js";
import { getTableBackspaceEdit } from "./editor-tables.js";

const PAIRS = {
  "(": ")",
  "[": "]",
  "{": "}",
  "\"": "\"",
  "'": "'",
  "`": "`"
};

const CLOSING_CHARACTERS = new Set(Object.values(PAIRS));

function replaceRange(value, start, end, text, selectionStart, selectionEnd = selectionStart) {
  return {
    value: value.slice(0, start) + text + value.slice(end),
    selectionStart,
    selectionEnd
  };
}

function getPairEdit(value, selectionStart, selectionEnd, key) {
  const selected = value.slice(selectionStart, selectionEnd);
  const inFence = isInsideFencedCode(value, selectionStart);
  const inInlineCode = isInsideInlineCode(value, selectionStart);

  if (selected) {
    if (inFence || (inInlineCode && key !== "`")) return null;

    let opening = key;
    let closing = PAIRS[key];
    if (key === "*" || key === "_") closing = key;
    if (key === "~") opening = closing = "~~";
    if (!closing || isEscaped(value, selectionStart)) return null;

    const replacement = `${opening}${selected}${closing}`;
    return replaceRange(
      value,
      selectionStart,
      selectionEnd,
      replacement,
      selectionStart + opening.length,
      selectionStart + opening.length + selected.length
    );
  }

  if (isEscaped(value, selectionStart) || inFence || (inInlineCode && key !== "`")) return null;

  if (CLOSING_CHARACTERS.has(key) && value[selectionStart] === key) {
    if (key === "`" && value[selectionStart - 1] === "`" && value[selectionStart - 2] !== "`") {
      return replaceRange(value, selectionStart, selectionStart, "`", selectionStart + 1);
    }
    return { moveTo: selectionStart + 1 };
  }

  const closing = PAIRS[key];
  if (!closing || inInlineCode) return null;
  if ((key === "\"" || key === "'") && /[\p{L}\p{N}]/u.test(value[selectionStart - 1] || "")) {
    return null;
  }

  return replaceRange(
    value,
    selectionStart,
    selectionStart,
    `${key}${closing}`,
    selectionStart + key.length
  );
}

function getBackspaceEdit(value, selectionStart, selectionEnd) {
  if (selectionStart !== selectionEnd || selectionStart === 0) return null;

  const tableEdit = getTableBackspaceEdit(value, selectionStart, selectionEnd);
  if (tableEdit) return tableEdit;

  const previous = value[selectionStart - 1];
  const next = value[selectionStart];
  if (PAIRS[previous] === next) {
    if (
      previous !== "`" &&
      (isInsideFencedCode(value, selectionStart) || isInsideInlineCode(value, selectionStart))
    ) return null;
    return replaceRange(value, selectionStart - 1, selectionStart + 1, "", selectionStart - 1);
  }

  if (isInsideFencedCode(value, selectionStart) || isInsideInlineCode(value, selectionStart)) return null;
  const lineStart = getLineStart(value, selectionStart);
  const line = value.slice(lineStart, getLineEnd(value, selectionStart));
  const item = parseListLine(line);
  if (!item || selectionStart !== lineStart + item.contentStart) return null;

  const markerStart = lineStart + item.markerStart;
  return replaceRange(value, markerStart, selectionStart, "", markerStart);
}

export function getSmartKeyEdit(value, selectionStart, selectionEnd, key) {
  if (key === "Backspace") return getBackspaceEdit(value, selectionStart, selectionEnd);
  return getPairEdit(value, selectionStart, selectionEnd, key);
}

function getHomePosition(value, selectionStart, selectionEnd) {
  if (
    selectionStart !== selectionEnd ||
    isInsideFencedCode(value, selectionStart) ||
    isInsideInlineCode(value, selectionStart)
  ) return null;
  const lineStart = getLineStart(value, selectionStart);
  const line = value.slice(lineStart, getLineEnd(value, selectionStart));
  const item = parseListLine(line);
  if (!item) return null;

  const contentStart = lineStart + item.contentStart;
  return selectionStart === contentStart ? lineStart : contentStart;
}

function getPreviousLineStart(value, lineStart) {
  return lineStart === 0 ? -1 : getLineStart(value, lineStart - 1);
}

function getNextLineStart(value, lineStart) {
  const lineEnd = getLineEnd(value, lineStart);
  return lineEnd === value.length ? -1 : lineEnd + 1;
}

function getListSubtreeEnd(value, lineStart, item) {
  let subtreeEnd = getLineEnd(value, lineStart);
  let nextStart = getNextLineStart(value, lineStart);

  while (nextStart >= 0) {
    const nextEnd = getLineEnd(value, nextStart);
    const line = value.slice(nextStart, nextEnd);
    if (!line.trim()) break;

    const child = parseListLine(line);
    if (!child || child.container !== item.container || child.indentColumns <= item.indentColumns) {
      break;
    }

    subtreeEnd = nextEnd;
    nextStart = getNextLineStart(value, nextStart);
  }

  return subtreeEnd;
}

function getPreviousSibling(value, lineStart, item) {
  let candidateStart = getPreviousLineStart(value, lineStart);
  while (candidateStart >= 0) {
    const line = value.slice(candidateStart, getLineEnd(value, candidateStart));
    if (!line.trim()) return null;
    const candidate = parseListLine(line);
    if (!candidate || candidate.container !== item.container) return null;
    if (candidate.indentColumns < item.indentColumns) return null;
    if (candidate.indentColumns === item.indentColumns) {
      return { item: candidate, lineStart: candidateStart };
    }
    candidateStart = getPreviousLineStart(value, candidateStart);
  }
  return null;
}

function replaceOrderedMarker(block, item, number) {
  if (item.number === null) return block;
  const marker = `${number}${item.delimiter}`;
  return block.slice(0, item.markerStart) + marker +
    block.slice(item.markerStart + item.marker.length);
}

export function getListMoveEdit(value, selectionStart, selectionEnd, direction) {
  if (
    selectionStart !== selectionEnd ||
    isInsideFencedCode(value, selectionStart) ||
    isInsideInlineCode(value, selectionStart) ||
    ![1, -1].includes(direction)
  ) return null;

  const lineStart = getLineStart(value, selectionStart);
  const item = parseListLine(value.slice(lineStart, getLineEnd(value, lineStart)));
  if (!item) return null;

  const currentEnd = getListSubtreeEnd(value, lineStart, item);
  const cursorOffset = selectionStart - lineStart;

  if (direction < 0) {
    const previous = getPreviousSibling(value, lineStart, item);
    if (!previous) return null;
    const previousEnd = lineStart - 1;
    let previousBlock = value.slice(previous.lineStart, previousEnd);
    let currentBlock = value.slice(lineStart, currentEnd);
    if (item.number !== null && previous.item.number !== null) {
      currentBlock = replaceOrderedMarker(currentBlock, item, previous.item.number);
      previousBlock = replaceOrderedMarker(previousBlock, previous.item, item.number);
    }
    const replacement = `${currentBlock}\n${previousBlock}`;
    return replaceRange(
      value,
      previous.lineStart,
      currentEnd,
      replacement,
      previous.lineStart + cursorOffset
    );
  }

  const nextStart = currentEnd === value.length ? -1 : currentEnd + 1;
  if (nextStart < 0) return null;
  const nextItem = parseListLine(value.slice(nextStart, getLineEnd(value, nextStart)));
  if (
    !nextItem ||
    nextItem.container !== item.container ||
    nextItem.indentColumns !== item.indentColumns
  ) return null;

  const nextEnd = getListSubtreeEnd(value, nextStart, nextItem);
  let currentBlock = value.slice(lineStart, currentEnd);
  let nextBlock = value.slice(nextStart, nextEnd);
  if (item.number !== null && nextItem.number !== null) {
    currentBlock = replaceOrderedMarker(currentBlock, item, nextItem.number);
    nextBlock = replaceOrderedMarker(nextBlock, nextItem, item.number);
  }
  const replacement = `${nextBlock}\n${currentBlock}`;
  return replaceRange(
    value,
    lineStart,
    nextEnd,
    replacement,
    lineStart + nextBlock.length + 1 + cursorOffset
  );
}

function isPasteableUrl(text) {
  if (text !== text.trim() || /\s/.test(text)) return false;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function escapeTableCell(text) {
  return text.trim().replaceAll("|", "\\|");
}

function getTsvTable(text) {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  if (lines.length < 2 || !lines.some((line) => line.includes("\t"))) return null;

  const rows = lines.map((line) => line.split("\t").map(escapeTableCell));
  const columnCount = Math.max(...rows.map((row) => row.length));
  const makeRow = (cells) => `| ${[
    ...cells,
    ...Array(columnCount - cells.length).fill("")
  ].join(" | ")} |`;

  return [
    makeRow(rows[0]),
    makeRow(Array(columnCount).fill("---")),
    ...rows.slice(1).map(makeRow)
  ].join("\n");
}

export function getMarkdownPasteEdit(value, selectionStart, selectionEnd, text) {
  if (isInsideFencedCode(value, selectionStart) || isInsideInlineCode(value, selectionStart)) {
    return null;
  }

  const selected = value.slice(selectionStart, selectionEnd);
  if (selected && isPasteableUrl(text)) {
    const replacement = `[${selected}](${text})`;
    const cursor = selectionStart + replacement.length;
    return replaceRange(value, selectionStart, selectionEnd, replacement, cursor);
  }

  const table = getTsvTable(text);
  if (table) {
    const cursor = selectionStart + table.length;
    return replaceRange(value, selectionStart, selectionEnd, table, cursor);
  }

  return null;
}

export function handleEditorSmartKeydown(event) {
  if (event.isComposing || event.metaKey || event.ctrlKey) return;
  const textarea = event.currentTarget;

  if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    const edit = getListMoveEdit(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd,
      event.key === "ArrowUp" ? -1 : 1
    );
    if (!edit) return;
    event.preventDefault();
    event.stopPropagation();
    applyEditorEdit(textarea, edit);
    return;
  }
  if (event.altKey) return;

  if (event.key === "Home" && !event.shiftKey) {
    const position = getHomePosition(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd
    );
    if (position === null) return;
    event.preventDefault();
    textarea.setSelectionRange(position, position);
    return;
  }

  const edit = getSmartKeyEdit(
    textarea.value,
    textarea.selectionStart,
    textarea.selectionEnd,
    event.key
  );
  if (!edit) return;

  event.preventDefault();
  if (edit.moveTo !== undefined) {
    textarea.setSelectionRange(edit.moveTo, edit.moveTo);
  } else {
    applyEditorEdit(textarea, edit);
  }
}

export function handleMarkdownPaste(event) {
  const text = event.clipboardData?.getData("text/plain");
  if (!text) return;

  const textarea = event.currentTarget;
  const edit = getMarkdownPasteEdit(
    textarea.value,
    textarea.selectionStart,
    textarea.selectionEnd,
    text
  );
  if (!edit) return;

  event.preventDefault();
  applyEditorEdit(textarea, edit);
}
