// SPDX-License-Identifier: GPL-3.0-or-later

export const INDENT_WIDTH = 4;

export function getLineStart(value, position) {
  return value.lastIndexOf("\n", position - 1) + 1;
}

export function getLineEnd(value, position) {
  const lineEnd = value.indexOf("\n", position);
  return lineEnd === -1 ? value.length : lineEnd;
}

export function getIndentColumns(indentation) {
  return [...indentation].reduce(
    (columns, character) => character === "\t"
      ? columns + INDENT_WIDTH - (columns % INDENT_WIDTH)
      : columns + 1,
    0
  );
}

export function removeIndentLevel(indentation) {
  if (indentation.endsWith("\t")) return indentation.slice(0, -1);
  return indentation.slice(0, Math.max(0, indentation.length - INDENT_WIDTH));
}

export function getBlockquotePrefix(line) {
  const leading = line.match(/^[ \t]{0,3}/)[0];
  if (line[leading.length] !== ">") return "";

  let position = leading.length;
  while (line[position] === ">") {
    position += 1;
    if (line[position] === " " || line[position] === "\t") position += 1;
  }
  return line.slice(0, position);
}

export function parseListLine(line) {
  const container = getBlockquotePrefix(line);
  const content = line.slice(container.length);
  const match = content.match(/^([ \t]*)([-+*]|(\d+)([.)]))([ \t]+)(.*)$/);
  if (!match) return null;

  const [, indentation, marker, number, delimiter, spacing, body] = match;
  const task = body.match(/^\[([ xX])\]([ \t]+)?(.*)$/);
  const markerStart = container.length + indentation.length;
  const contentStart = markerStart + marker.length + spacing.length +
    (task ? 3 + (task[2] || "").length : 0);

  return {
    body: task ? task[3] : body,
    container,
    contentStart,
    delimiter,
    indentation,
    indentColumns: getIndentColumns(indentation),
    marker,
    markerStart,
    number: number ? Number(number) : null,
    spacing,
    task: task ? { checked: task[1].toLowerCase() === "x", spacing: task[2] || " " } : null
  };
}

function getFenceMarker(line) {
  const container = getBlockquotePrefix(line);
  const match = line.slice(container.length).match(/^[ ]{0,3}(`{3,}|~{3,})(.*)$/);
  if (!match) return null;
  return {
    character: match[1][0],
    container,
    length: match[1].length,
    suffix: match[2]
  };
}

export function getFenceStateBeforeLine(value, lineStart) {
  const lines = value.slice(0, lineStart).split("\n");
  let fence = null;

  for (const line of lines) {
    const marker = getFenceMarker(line);
    if (!marker) continue;

    if (!fence) {
      fence = marker;
    } else if (
      marker.character === fence.character &&
      marker.container === fence.container &&
      marker.length >= fence.length &&
      !marker.suffix.trim()
    ) {
      fence = null;
    }
  }

  return fence;
}

export function isInsideFencedCode(value, position) {
  const lineStart = getLineStart(value, position);
  return Boolean(getFenceStateBeforeLine(value, lineStart));
}

export function isEscaped(value, position) {
  let backslashes = 0;
  for (let index = position - 1; index >= 0 && value[index] === "\\"; index -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

export function isInsideInlineCode(value, position) {
  const line = value.slice(getLineStart(value, position), position);
  let openRun = 0;

  for (let index = 0; index < line.length;) {
    if (line[index] !== "`" || isEscaped(line, index)) {
      index += 1;
      continue;
    }

    let end = index + 1;
    while (line[end] === "`") end += 1;
    const run = end - index;
    openRun = openRun === run ? 0 : (openRun === 0 ? run : openRun);
    index = end;
  }

  return openRun > 0;
}
