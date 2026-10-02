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

function comparableText(value, cleanLine) {
  return cleanLine(String(value || ""))
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

export function getNotePreview(note, lineCount = 2, format = "MD") {
  const numericLineCount = Number(lineCount);
  const normalizedLineCount = Number.isFinite(numericLineCount) ? Math.round(numericLineCount) : 2;
  const previewLineCount = Math.min(10, Math.max(1, normalizedLineCount));
  const cleanLine = format === "MD" ? cleanPreviewLine : line => line.trim();
  const lines = String(note.content || "")
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);

  if (lines.length === 0) return "Empty scratchpad...";

  const firstLineMatchesTitle = comparableText(lines[0], cleanLine) === comparableText(note.title, cleanLine) ||
    (!note.isTitleLocked && comparableText(lines[0], cleanLine).startsWith(comparableText(note.title, cleanLine)));

  if (firstLineMatchesTitle) {
    const previewLines = lines.slice(1, 1 + previewLineCount);
    return previewLines.length > 0 ? previewLines.join("\n") : "No additional content...";
  }

  return lines.slice(0, previewLineCount).join("\n");
}
