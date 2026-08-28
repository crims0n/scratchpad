// SPDX-License-Identifier: GPL-3.0-or-later

const TAB_WIDTH = 4;

function getLineStart(value, position) {
  return value.lastIndexOf("\n", position - 1) + 1;
}

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

export function getIndentEdit(value, selectionStart, selectionEnd, outdent = false) {
  if (!outdent && selectionStart === selectionEnd) {
    return {
      value: value.slice(0, selectionStart) + "\t" + value.slice(selectionEnd),
      selectionStart: selectionStart + 1,
      selectionEnd: selectionStart + 1
    };
  }

  const edits = getSelectedLineStarts(value, selectionStart, selectionEnd)
    .map((position) => {
      if (!outdent) {
        return { position, removeLength: 0, insertText: "\t" };
      }

      if (value[position] === "\t") {
        return { position, removeLength: 1, insertText: "" };
      }

      const leadingSpaces = value.slice(position, position + TAB_WIDTH).match(/^ +/)?.[0].length || 0;
      return { position, removeLength: leadingSpaces, insertText: "" };
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
  const selectionDirection = textarea.selectionDirection;
  const edit = getIndentEdit(
    textarea.value,
    textarea.selectionStart,
    textarea.selectionEnd,
    event.shiftKey
  );

  event.preventDefault();
  textarea.value = edit.value;
  textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd, selectionDirection);
  textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
}
