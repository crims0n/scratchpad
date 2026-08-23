// SPDX-License-Identifier: GPL-3.0-or-later

function cleanPreviewLine(line) {
  return line
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s?/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/[`*_~]/g, "")
    .trim();
}

function comparableText(value) {
  return cleanPreviewLine(String(value || ""))
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

export function getNotePreview(note) {
  const lines = String(note.content || "")
    .split(/\r?\n/)
    .map(cleanPreviewLine)
    .filter(Boolean);

  if (lines.length === 0) return "Empty scratchpad...";

  const firstLineMatchesTitle = comparableText(lines[0]) === comparableText(note.title) ||
    (!note.isTitleLocked && comparableText(lines[0]).startsWith(comparableText(note.title)));

  if (firstLineMatchesTitle) {
    return lines[1] || "No additional content...";
  }

  return lines[0];
}
