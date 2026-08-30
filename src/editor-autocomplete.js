// SPDX-License-Identifier: GPL-3.0-or-later

import {
  getBlockquotePrefix,
  getFenceStateBeforeLine,
  getLineEnd,
  getLineStart,
  isInsideInlineCode,
  parseListLine,
  removeIndentLevel
} from "./editor-context.js";
import { applyEditorEdit } from "./editor-edit.js";
import { getTableEnterEdit } from "./editor-tables.js";

function applyTextEdits(value, edits) {
  return [...edits].reverse().reduce((result, edit) => (
    result.slice(0, edit.start) + edit.text + result.slice(edit.end)
  ), value);
}

function preserveExplicitTrailingLine(edit) {
  if (
    edit.selectionStart > 0 &&
    edit.selectionStart === edit.value.length &&
    edit.value.endsWith("\n")
  ) {
    return { ...edit, value: `${edit.value}\n` };
  }
  return edit;
}

function renumberFollowingItems(value, position, listItem, nextNumber) {
  const edits = [];
  let lineStart = value.indexOf("\n", position);
  if (lineStart === -1) return value;
  lineStart += 1;

  while (lineStart <= value.length) {
    const lineEnd = getLineEnd(value, lineStart);
    const line = value.slice(lineStart, lineEnd);
    if (!line.trim()) break;

    const item = parseListLine(line);
    if (!item || item.container !== listItem.container) break;
    if (item.indentColumns < listItem.indentColumns) break;

    if (item.indentColumns === listItem.indentColumns) {
      if (item.number === null || item.delimiter !== listItem.delimiter) break;
      edits.push({
        start: lineStart + item.markerStart,
        end: lineStart + item.markerStart + item.marker.length,
        text: `${nextNumber}${item.delimiter}`
      });
      nextNumber += 1;
    }

    if (lineEnd === value.length) break;
    lineStart = lineEnd + 1;
  }

  return applyTextEdits(value, edits);
}

function getListContinuationEdit(value, selectionStart) {
  const lineStart = getLineStart(value, selectionStart);
  const lineEnd = getLineEnd(value, selectionStart);
  const beforeCursor = value.slice(lineStart, selectionStart);
  const afterCursor = value.slice(selectionStart, lineEnd);
  const item = parseListLine(beforeCursor);
  if (!item) return null;

  if (!item.body.trim() && !afterCursor.trim()) {
    if (item.indentation) {
      const indentation = removeIndentLevel(item.indentation);
      const task = item.task ? `[ ]${item.task.spacing}` : "";
      const replacement = `${item.container}${indentation}${item.marker}${item.spacing}${task}`;
      const cursor = lineStart + replacement.length;
      return {
        value: value.slice(0, lineStart) + replacement + value.slice(lineEnd),
        selectionStart: cursor,
        selectionEnd: cursor
      };
    }

    const cursor = lineStart + item.container.length;
    return preserveExplicitTrailingLine({
      value: value.slice(0, lineStart) + item.container + value.slice(lineEnd),
      selectionStart: cursor,
      selectionEnd: cursor
    });
  }

  const marker = item.number === null
    ? item.marker
    : `${item.number + 1}${item.delimiter}`;
  const task = item.task ? `[ ]${item.task.spacing}` : "";
  const continuation = `${item.container}${item.indentation}${marker}${item.spacing}${task}`;
  const insertion = `\n${continuation}`;
  const cursor = selectionStart + insertion.length;
  const followingWhitespace = afterCursor.match(/^[ \t]*/)[0].length;
  let nextValue = value.slice(0, selectionStart) + insertion +
    value.slice(selectionStart + followingWhitespace);

  if (item.number !== null) {
    nextValue = renumberFollowingItems(nextValue, cursor, item, item.number + 2);
  }

  return {
    value: nextValue,
    selectionStart: cursor,
    selectionEnd: cursor
  };
}

function getFenceEdit(value, selectionStart) {
  const lineStart = getLineStart(value, selectionStart);
  const lineEnd = getLineEnd(value, selectionStart);
  const beforeCursor = value.slice(lineStart, selectionStart);
  const afterCursor = value.slice(selectionStart, lineEnd);
  const fenceBeforeLine = getFenceStateBeforeLine(value, lineStart);
  const container = getBlockquotePrefix(beforeCursor);
  const openingFence = beforeCursor.slice(container.length)
    .match(/^([ ]{0,3})(`{3,}|~{3,})([^`]*)$/);

  if (!fenceBeforeLine && openingFence && !afterCursor.trim()) {
    const [, indentation, marker] = openingFence;
    const linePrefix = `${container}${indentation}`;
    const insertion = `\n${linePrefix}\n${linePrefix}${marker}`;
    const cursor = selectionStart + 1 + linePrefix.length;
    return {
      value: value.slice(0, selectionStart) + insertion + value.slice(lineEnd),
      selectionStart: cursor,
      selectionEnd: cursor
    };
  }

  if (!fenceBeforeLine) return null;

  const closingContainer = getBlockquotePrefix(beforeCursor);
  const closingFence = beforeCursor.slice(closingContainer.length)
    .match(/^([ ]{0,3})(`{3,}|~{3,})[ \t]*$/);
  if (
    closingFence &&
    closingContainer === fenceBeforeLine.container &&
    closingFence[2][0] === fenceBeforeLine.character &&
    closingFence[2].length >= fenceBeforeLine.length
  ) return null;

  const lineContainer = getBlockquotePrefix(beforeCursor);
  const indentation = beforeCursor.slice(lineContainer.length).match(/^[ \t]*/)[0];
  const linePrefix = `${lineContainer}${indentation}`;
  const followingWhitespace = afterCursor.match(/^[ \t]*/)[0].length;
  const insertion = `\n${linePrefix}`;
  const cursor = selectionStart + insertion.length;
  return {
    value: value.slice(0, selectionStart) + insertion +
      value.slice(selectionStart + followingWhitespace),
    selectionStart: cursor,
    selectionEnd: cursor
  };
}

function getBlockquoteEdit(value, selectionStart) {
  const lineStart = getLineStart(value, selectionStart);
  const lineEnd = getLineEnd(value, selectionStart);
  const beforeCursor = value.slice(lineStart, selectionStart);
  const afterCursor = value.slice(selectionStart, lineEnd);
  const prefix = getBlockquotePrefix(beforeCursor);
  if (!prefix) return null;

  if (!beforeCursor.slice(prefix.length).trim() && !afterCursor.trim()) {
    return preserveExplicitTrailingLine({
      value: value.slice(0, lineStart) + value.slice(lineEnd),
      selectionStart: lineStart,
      selectionEnd: lineStart
    });
  }

  const insertion = `\n${prefix}`;
  const cursor = selectionStart + insertion.length;
  const followingWhitespace = afterCursor.match(/^[ \t]*/)[0].length;
  return {
    value: value.slice(0, selectionStart) + insertion +
      value.slice(selectionStart + followingWhitespace),
    selectionStart: cursor,
    selectionEnd: cursor
  };
}

export function getMarkdownAutocompleteEdit(value, selectionStart, selectionEnd) {
  if (selectionStart !== selectionEnd) return null;

  const fenceEdit = getFenceEdit(value, selectionStart);
  if (fenceEdit || isInsideInlineCode(value, selectionStart)) return fenceEdit;

  return getListContinuationEdit(value, selectionStart) ||
    getBlockquoteEdit(value, selectionStart) ||
    getTableEnterEdit(value, selectionStart, selectionEnd);
}

export function handleMarkdownAutocomplete(event) {
  if (
    event.key !== "Enter" ||
    event.shiftKey ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.isComposing
  ) return;

  const textarea = event.currentTarget;
  const edit = getMarkdownAutocompleteEdit(
    textarea.value,
    textarea.selectionStart,
    textarea.selectionEnd
  );

  if (!edit) return;

  event.preventDefault();
  applyEditorEdit(textarea, edit);
}
