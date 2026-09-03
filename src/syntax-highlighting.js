// SPDX-License-Identifier: GPL-3.0-or-later

const SYNTAX_CLASSES = new Set([
  "syntax-code",
  "syntax-code-block",
  "syntax-emphasis",
  "syntax-heading",
  "syntax-link",
  "syntax-punctuation"
]);

const DECORATION_CLASSES = new Set([
  "diff-line-added",
  "diff-line-removed",
  "diff-text-added",
  "diff-text-removed"
]);

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isEscaped(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function paint(classes, start, end, className) {
  if (!SYNTAX_CLASSES.has(className)) return;
  for (let index = Math.max(0, start); index < Math.min(classes.length, end); index += 1) {
    if (classes[index] === null) classes[index] = className;
  }
}

function paintMatches(line, lineStart, expression, className, classes) {
  expression.lastIndex = 0;
  for (const match of line.matchAll(expression)) {
    const start = match.index ?? 0;
    if (isEscaped(line, start)) continue;
    paint(classes, lineStart + start, lineStart + start + match[0].length, className);
  }
}

function buildSyntaxClasses(text) {
  const classes = Array.from({ length: text.length }, () => null);
  let offset = 0;
  let openFence = null;

  for (const lineWithBreak of text.match(/.*(?:\n|$)/g) ?? []) {
    if (lineWithBreak === "" && offset >= text.length) break;
    const line = lineWithBreak.endsWith("\n") ? lineWithBreak.slice(0, -1) : lineWithBreak;
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);

    if (openFence) {
      const closingFence = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (
        closingFence &&
        closingFence[1][0] === openFence.character &&
        closingFence[1].length >= openFence.length
      ) {
        paint(classes, offset, offset + line.length, "syntax-punctuation");
        openFence = null;
      } else {
        paint(classes, offset, offset + line.length, "syntax-code-block");
      }
      offset += lineWithBreak.length;
      continue;
    }

    if (fence) {
      const markerStart = line.indexOf(fence[1]);
      paint(classes, offset + markerStart, offset + markerStart + fence[1].length, "syntax-punctuation");
      paint(classes, offset + markerStart + fence[1].length, offset + line.length, "syntax-code");
      openFence = { character: fence[1][0], length: fence[1].length };
      offset += lineWithBreak.length;
      continue;
    }

    const horizontalRule = line.match(/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/);
    if (horizontalRule) {
      paint(classes, offset, offset + line.length, "syntax-punctuation");
      offset += lineWithBreak.length;
      continue;
    }

    const heading = line.match(/^( {0,3})(#{1,6})(?:[ \t]+|$)/);
    if (heading) {
      const markerStart = heading[1].length;
      paint(classes, offset + markerStart, offset + markerStart + heading[2].length, "syntax-punctuation");
      paint(classes, offset + heading[0].length, offset + line.length, "syntax-heading");
    }

    const quote = line.match(/^ {0,3}(?:>[ \t]?)+/);
    if (quote) paint(classes, offset, offset + quote[0].length, "syntax-punctuation");

    const list = line.match(/^((?: {0,3}>[ \t]?)*[ \t]*)([-+*]|\d+[.)])([ \t]+)/);
    if (list) {
      const markerStart = list[1].length;
      paint(
        classes,
        offset + markerStart,
        offset + markerStart + list[2].length,
        "syntax-punctuation"
      );
      const taskStart = markerStart + list[2].length + list[3].length;
      const task = line.slice(taskStart).match(/^\[[ xX]\](?=[ \t]|$)/);
      if (task) paint(classes, offset + taskStart, offset + taskStart + task[0].length, "syntax-punctuation");
    }

    // Inline code takes priority over the other inline constructs.
    paintMatches(line, offset, /(`+)(?!`)[^\n]*?\1/g, "syntax-code", classes);
    paintMatches(line, offset, /!?\[[^\]\n]*\]\([^\n)]*\)/g, "syntax-link", classes);
    paintMatches(line, offset, /!?\[[^\]\n]+\]\[[^\]\n]*\]/g, "syntax-link", classes);
    paintMatches(line, offset, /<https?:\/\/[^>\n]+>/g, "syntax-link", classes);
    paintMatches(line, offset, /(?:\*\*|__|~~)(?=\S).+?\S(?:\*\*|__|~~)/g, "syntax-emphasis", classes);
    paintMatches(line, offset, /(?:\*|_)(?=\S)[^\n]*?\S(?:\*|_)/g, "syntax-emphasis", classes);

    offset += lineWithBreak.length;
  }

  return classes;
}

function normalizeMatches(matches, textLength) {
  return (matches ?? [])
    .map((match, originalIndex) => ({
      start: Math.max(0, Math.min(textLength, Number(match.start))),
      end: Math.max(0, Math.min(textLength, Number(match.end))),
      originalIndex
    }))
    .filter((match) => Number.isFinite(match.start) && Number.isFinite(match.end) && match.end > match.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
}

function normalizeDecorations(decorations, textLength) {
  return (decorations ?? [])
    .map((item) => ({
      start: Math.max(0, Math.min(textLength, Number(item.start))),
      end: Math.max(0, Math.min(textLength, Number(item.end))),
      className: item.className
    }))
    .filter((item) => (
      Number.isFinite(item.start) &&
      Number.isFinite(item.end) &&
      item.end > item.start &&
      DECORATION_CLASSES.has(item.className)
    ))
    .sort((left, right) => left.start - right.start || left.end - right.end);
}

export function renderEditorBackdrop(
  text,
  { syntaxEnabled = true, matches = [], activeMatchIndex = -1, decorations = [] } = {}
) {
  const source = String(text ?? "");
  const syntaxClasses = syntaxEnabled
    ? buildSyntaxClasses(source)
    : Array.from({ length: source.length }, () => null);
  const normalizedMatches = normalizeMatches(matches, source.length);
  const normalizedDecorations = normalizeDecorations(decorations, source.length);
  const boundaries = new Set([0, source.length]);
  const decorationStarts = new Map();
  const decorationEnds = new Map();

  for (let index = 1; index < syntaxClasses.length; index += 1) {
    if (syntaxClasses[index] !== syntaxClasses[index - 1]) boundaries.add(index);
  }
  normalizedMatches.forEach((match) => {
    boundaries.add(match.start);
    boundaries.add(match.end);
  });
  normalizedDecorations.forEach((item) => {
    boundaries.add(item.start);
    boundaries.add(item.end);
    decorationStarts.set(item.start, [...(decorationStarts.get(item.start) ?? []), item]);
    decorationEnds.set(item.end, [...(decorationEnds.get(item.end) ?? []), item]);
  });

  const orderedBoundaries = [...boundaries].sort((left, right) => left - right);
  const activeDecorations = new Set();
  let matchIndex = 0;
  let html = "";

  for (let boundaryIndex = 0; boundaryIndex < orderedBoundaries.length - 1; boundaryIndex += 1) {
    const start = orderedBoundaries[boundaryIndex];
    const end = orderedBoundaries[boundaryIndex + 1];
    decorationEnds.get(start)?.forEach((item) => activeDecorations.delete(item));
    decorationStarts.get(start)?.forEach((item) => activeDecorations.add(item));

    while (matchIndex < normalizedMatches.length && normalizedMatches[matchIndex].end <= start) {
      matchIndex += 1;
    }

    const match = normalizedMatches[matchIndex];
    const insideMatch = match && match.start <= start && start < match.end;
    const syntaxClass = syntaxClasses[start];

    let fragment = escapeHTML(source.slice(start, end));
    if (syntaxClass) fragment = `<span class="${syntaxClass}">${fragment}</span>`;
    if (insideMatch) {
      const activeClass = match.originalIndex === activeMatchIndex ? ' class="active-match"' : "";
      fragment = `<mark${activeClass}>${fragment}</mark>`;
    }
    if (activeDecorations.size > 0) {
      const classNames = [...new Set([...activeDecorations].map((item) => item.className))].join(" ");
      fragment = `<span class="${classNames}">${fragment}</span>`;
    }
    html += fragment;
  }

  // The extra line keeps the backdrop's final empty line aligned with a textarea.
  return `${html}\n`;
}

export function highlightPreviewCode(container, highlighter, enabled = true) {
  if (!enabled || !container || !highlighter) return 0;
  let highlightedCount = 0;

  for (const code of container.querySelectorAll("pre > code")) {
    const languageClass = [...code.classList].find((className) => className.startsWith("language-"));
    const language = languageClass?.slice("language-".length).trim();
    if (!language || !highlighter.getLanguage?.(language)) continue;

    try {
      const result = highlighter.highlight(code.textContent ?? "", {
        language,
        ignoreIllegals: true
      });
      code.innerHTML = result.value;
      code.classList.add("hljs");
      highlightedCount += 1;
    } catch (error) {
      console.warn(`Could not highlight ${language} code block`, error);
    }
  }

  return highlightedCount;
}
