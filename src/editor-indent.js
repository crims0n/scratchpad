// SPDX-License-Identifier: GPL-3.0-or-later

import {
  INDENT_WIDTH,
  getBlockquotePrefix,
  getIndentColumns,
  getLineEnd,
  getLineStart,
  isInsideFencedCode,
  parseListLine
} from "./editor-context.js";
import { applyEditorEdit } from "./editor-edit.js";
import { getTableTabEdit } from "./editor-tables.js";

function getSelectedLineStarts(value, selectionStart, selectionEnd) {
  const starts = [getLineStart(value, selectionStart)];
  const lastSelectedPosition = selectionEnd > selectionStart && value[selectionEnd - 1] === "\n"
    ? selectionEnd - 1
    : selectionEnd;

  let nextLineStart = value.indexOf("\n", starts[0]) + 1;
  while (nextLineStart > 0 && nextLineStart <= lastSelectedPosition) {
    starts.push(nextLineStart);
    nextLineStart = value.indexOf("\n", nextLineStart) + 1;
  }

  return starts;
}

function mapPositionThroughEdits(position, edits) {
  let mapped = position;

  for (const edit of edits) {
    const editEnd = edit.position + edit.removeLength;
    if (position < edit.position) continue;

    if (position <= editEnd) {
      mapped += edit.position + edit.insertText.length - position;
    } else {
      mapped += edit.insertText.length - edit.removeLength;
    }
  }

  return mapped;
}

function applyEdits(value, edits) {
  return [...edits]
    .reverse()
    .reduce((result, edit) => (
      result.slice(0, edit.position) +
      edit.insertText +
      result.slice(edit.position + edit.removeLength)
    ), value);
}

function getIndentRemovalLength(value, position) {
  if (value[position] === "\t") return 1;
  return value.slice(position, position + INDENT_WIDTH).match(/^ +/)?.[0].length || 0;
}

function getListSubtreeLines(value, lineStart, item) {
  const lines = [{ lineStart, container: item.container }];
  let nextStart = getLineEnd(value, lineStart);
  if (nextStart === value.length) return lines;
  nextStart += 1;

  while (nextStart <= value.length) {
    const lineEnd = getLineEnd(value, nextStart);
    const line = value.slice(nextStart, lineEnd);
    if (!line.trim()) break;

    const childItem = parseListLine(line);
    if (childItem) {
      if (
        childItem.container !== item.container ||
        childItem.indentColumns <= item.indentColumns
      ) break;
      lines.push({ lineStart: nextStart, container: childItem.container });
    } else {
      const container = getBlockquotePrefix(line);
      if (container !== item.container) break;
      const indentation = line.slice(container.length).match(/^[ \t]*/)[0];
      if (getIndentColumns(indentation) <= item.indentColumns) break;
      lines.push({ lineStart: nextStart, container });
    }

    if (lineEnd === value.length) break;
    nextStart = lineEnd + 1;
  }

  return lines;
}

function getListIndentEdit(value, selectionStart, item, outdent) {
  const lineStart = getLineStart(value, selectionStart);
  const lines = getListSubtreeLines(value, lineStart, item);
  const edits = lines.map(({ lineStart: start, container }) => {
    const position = start + container.length;
    return outdent
      ? {
          position,
          removeLength: getIndentRemovalLength(value, position),
          insertText: ""
        }
      : { position, removeLength: 0, insertText: "\t" };
  });

  if (!outdent && item.number !== null && item.marker !== `1${item.delimiter}`) {
    edits.push({
      position: lineStart + item.markerStart,
      removeLength: item.marker.length,
      insertText: `1${item.delimiter}`
    });
  }

  edits.sort((left, right) => left.position - right.position);
  const actionableEdits = edits.filter((edit) => edit.removeLength > 0 || edit.insertText);
  return {
    value: applyEdits(value, actionableEdits),
    selectionStart: mapPositionThroughEdits(selectionStart, actionableEdits),
    selectionEnd: mapPositionThroughEdits(selectionStart, actionableEdits)
  };
}

export function getIndentEdit(value, selectionStart, selectionEnd, outdent = false) {
  const tableEdit = getTableTabEdit(value, selectionStart, selectionEnd, outdent);
  if (tableEdit) return tableEdit;

  if (selectionStart === selectionEnd) {
    const lineStart = getLineStart(value, selectionStart);
    const line = value.slice(lineStart, getLineEnd(value, selectionStart));
    const item = parseListLine(line);
    const atListStart = item && selectionStart <= lineStart + item.contentStart;

    if (!isInsideFencedCode(value, selectionStart) && item && (outdent || atListStart)) {
      return getListIndentEdit(value, selectionStart, item, outdent);
    }

    if (!outdent) {
      return {
        value: value.slice(0, selectionStart) + "\t" + value.slice(selectionEnd),
        selectionStart: selectionStart + 1,
        selectionEnd: selectionStart + 1
      };
    }
  }

  const edits = getSelectedLineStarts(value, selectionStart, selectionEnd)
    .map((position) => {
      if (!outdent) {
        return { position, removeLength: 0, insertText: "\t" };
      }

      return {
        position,
        removeLength: getIndentRemovalLength(value, position),
        insertText: ""
      };
    })
    .filter((edit) => edit.removeLength > 0 || edit.insertText);

  return {
    value: applyEdits(value, edits),
    selectionStart: mapPositionThroughEdits(selectionStart, edits),
    selectionEnd: mapPositionThroughEdits(selectionEnd, edits)
  };
}

export function handleEditorTab(event) {
  if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey) return;

  const textarea = event.currentTarget;
  const edit = getIndentEdit(
    textarea.value,
    textarea.selectionStart,
    textarea.selectionEnd,
    event.shiftKey
  );

  event.preventDefault();
  if (edit.value === textarea.value) {
    textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
  } else {
    applyEditorEdit(textarea, edit);
  }
}
