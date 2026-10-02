// SPDX-License-Identifier: GPL-3.0-or-later

const SYNTAX_CLASSES = new Set([
  "syntax-code",
  "syntax-code-block",
  "syntax-emphasis",
  "syntax-heading",
  "syntax-link",
  "syntax-punctuation",
  "syntax-key",
  "syntax-string",
  "syntax-number",
  "syntax-literal",
  "syntax-tag",
  "syntax-comment",
  "syntax-meta",
  "syntax-csv-0",
  "syntax-csv-1",
  "syntax-csv-2"
]);

const FORMAT_LANGUAGES = { JSON: "json", XML: "xml", YAML: "yaml" };
const TOKEN_CLASSES = {
  "hljs-attr": "syntax-key",
  "hljs-attribute": "syntax-key",
  "hljs-string": "syntax-string",
  "hljs-number": "syntax-number",
  "hljs-literal": "syntax-literal",
  "hljs-keyword": "syntax-literal",
  "hljs-tag": "syntax-tag",
  "hljs-name": "syntax-tag",
  "hljs-comment": "syntax-comment",
  "hljs-meta": "syntax-meta",
  "hljs-punctuation": "syntax-punctuation",
  "hljs-bullet": "syntax-punctuation",
  "hljs-symbol": "syntax-number",
  "hljs-type": "syntax-literal"
};

const HIGHLIGHT_ENTITIES = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'"
};

const DECORATION_CLASSES = new Set([
  "diff-line-added",
  "diff-line-removed",
  "diff-text-added",
  "diff-text-removed"
]);

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

function buildMarkdownClasses(text) {
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

function buildCsvClasses(text) {
  const classes = Array(text.length).fill(null);
  let column = 0;
  let start = 0;
  let quoted = false;
  for (let index = 0; index <= text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { index += 1; continue; }
      quoted = !quoted;
    }
    if (!quoted && (character === ',' || character === '\n' || character === '\r' || character === undefined)) {
      paint(classes, start, index, `syntax-csv-${column % 3}`);
      if (character === ',') {
        paint(classes, index, index + 1, "syntax-punctuation");
        column += 1;
      } else {
        column = 0;
        if (character === '\r' && text[index + 1] === '\n') index += 1;
      }
      start = index + 1;
    }
  }
  return classes;
}

function buildFormatClasses(text, format, highlighter) {
  if (format === "MD") return buildMarkdownClasses(text);
  if (format === "CSV") return buildCsvClasses(text);
  const language = FORMAT_LANGUAGES[format];
  if (!language || !highlighter?.getLanguage?.(language)) return [];

  try {
    const result = highlighter.highlight(text, { language, ignoreIllegals: true });
    // Highlight.js emits only escaped text and nested span tokens. Read their
    // ranges in one pass, without constructing thousands of temporary DOM nodes.
    // Only known color classes survive; we always render escaped original source.
    const classes = Array(text.length).fill(null);
    const stack = [null];
    const fragments = [];
    let offset = 0;
    let htmlOffset = 0;
    for (const match of result.value.matchAll(/<span class="([^"]*)">|<\/span>|([^<]+)/g)) {
      if (match.index !== htmlOffset) return [];
      htmlOffset += match[0].length;
      if (match[1] !== undefined) {
        const className = match[1].split(/\s+/)
          .map(name => Object.hasOwn(TOKEN_CLASSES, name) ? TOKEN_CLASSES[name] : null)
          .find(Boolean) ?? stack.at(-1);
        stack.push(className);
      } else if (match[0] === "</span>") {
        if (stack.length === 1) return [];
        stack.pop();
      } else {
        const fragment = match[2].replace(/&(?:amp|lt|gt|quot|#x27);/g, entity => HIGHLIGHT_ENTITIES[entity]);
        fragments.push(fragment);
        const end = offset + fragment.length;
        if (end > text.length) return [];
        if (stack.at(-1)) classes.fill(stack.at(-1), offset, end);
        offset = end;
      }
    }
    return htmlOffset === result.value.length && stack.length === 1 && fragments.join("") === text ? classes : [];
  } catch {
    // A missing or failing grammar must still leave all source text readable.
    return [];
  }
}

function syntaxSettings(options) {
  return {
    enabled: options.syntaxEnabled ?? true,
    format: options.format ?? "MD",
    highlighter: options.highlighter ?? globalThis.window?.hljs
  };
}

// Native editor decorations use the detected format colors.
// Cache token ranges separately so Find/Compare never retokenize unchanged text.
export function createEditorDecorationBuilder() {
  let previous = null;
  return (text, options = {}) => {
    const source = String(text ?? "");
    const settings = syntaxSettings(options);
    if (!previous || previous.source !== source || Object.keys(settings).some(key => previous[key] !== settings[key])) {
      const classes = settings.enabled ? buildFormatClasses(source, settings.format, settings.highlighter) : [];
      const ranges = [];
      for (let start = 0; start < classes.length;) {
        let end = start + 1;
        while (end < classes.length && classes[end] === classes[start]) end += 1;
        if (classes[start]) ranges.push({ start, end, className: classes[start] });
        start = end;
      }
      previous = { source, ...settings, ranges };
    }
    return [
      ...previous.ranges,
      ...normalizeMatches(options.matches, source.length).map(match => ({
        ...match,
        className: match.originalIndex === options.activeMatchIndex ? "find-match active-match" : "find-match",
        tagName: "mark"
      })),
      ...normalizeDecorations(options.decorations, source.length)
    ];
  };
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
