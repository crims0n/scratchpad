// SPDX-License-Identifier: GPL-3.0-or-later

function getChangedRange(previousValue, nextValue) {
  let start = 0;
  while (
    start < previousValue.length &&
    start < nextValue.length &&
    previousValue[start] === nextValue[start]
  ) start += 1;

  let previousEnd = previousValue.length;
  let nextEnd = nextValue.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previousValue[previousEnd - 1] === nextValue[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  return {
    start,
    previousEnd,
    replacement: nextValue.slice(start, nextEnd)
  };
}

export function applyEditorEdit(textarea, edit) {
  const selectionDirection = textarea.selectionDirection;
  const change = getChangedRange(textarea.value, edit.value);

  textarea.setSelectionRange(change.start, change.previousEnd);
  const usedNativeUndo = typeof document.execCommand === "function" &&
    document.execCommand("insertText", false, change.replacement);

  if (!usedNativeUndo) {
    textarea.setRangeText(change.replacement, change.start, change.previousEnd, "end");
    textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
  }

  textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd, selectionDirection);
}
