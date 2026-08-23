// SPDX-License-Identifier: GPL-3.0-or-later

export function getCursorPosition(
  text,
  selectionStart = 0,
  selectionEnd = selectionStart,
  selectionDirection = "none"
) {
  const activeOffset = selectionStart !== selectionEnd && selectionDirection === "backward"
    ? selectionStart
    : selectionEnd;
  const offset = Math.max(0, Math.min(activeOffset, text.length));
  const textBeforeCursor = text.slice(0, offset);
  const lastLineBreak = textBeforeCursor.lastIndexOf("\n");
  const lineBreaks = textBeforeCursor.match(/\n/g)?.length || 0;

  return {
    line: lineBreaks + 1,
    column: lastLineBreak === -1 ? offset + 1 : offset - lastLineBreak
  };
}
