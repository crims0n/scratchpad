// SPDX-License-Identifier: GPL-3.0-or-later

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderEditorLineNumbers(text, { changedLines = [], changeType = null } = {}) {
  const changedLineSet = new Set(changedLines);
  const changeClass = changeType === "added"
    ? " editor-line-number-diff-added"
    : changeType === "removed"
      ? " editor-line-number-diff-removed"
      : "";

  return String(text ?? "")
    .split("\n")
    .map((line, index) => (
      `<div class="editor-line-number-row${changedLineSet.has(index) ? changeClass : ""}" data-line-number="${index + 1}">` +
      `${line ? escapeHTML(line) : "&#8203;"}</div>`
    ))
    .join("");
}
