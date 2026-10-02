// SPDX-License-Identifier: GPL-3.0-or-later

const xmlErrorNamespaces = new WeakMap();

function isXml(source, Parser) {
  const parser = new Parser();
  // Chromium/WebKit and Firefox use different namespaces for parse errors.
  // Discover the engine's error node once instead of assuming a namespace.
  if (!xmlErrorNamespaces.has(Parser)) {
    const error = parser.parseFromString('<', 'application/xml').getElementsByTagName('parsererror')[0];
    if (!error) return false;
    xmlErrorNamespaces.set(Parser, error.namespaceURI);
  }
  const document = parser.parseFromString(source, 'application/xml');
  return Boolean(document.documentElement)
    && document.getElementsByTagNameNS(xmlErrorNamespaces.get(Parser), 'parsererror').length === 0;
}

function isCsv(source) {
  let columns = 1;
  let expectedColumns = null;
  let rows = 0;
  let quoted = false;
  let afterQuote = false;
  let fieldStart = true;

  for (let index = 0; index <= source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === undefined) return false;
      if (character === '"') {
        if (source[index + 1] === '"') index += 1;
        else { quoted = false; afterQuote = true; }
      }
      continue;
    }
    if (character === '\n' || character === undefined) {
      if (columns < 2 || (expectedColumns !== null && columns !== expectedColumns)) return false;
      expectedColumns = columns;
      rows += 1;
      columns = 1;
      fieldStart = true;
      afterQuote = false;
    } else if (character === ',') {
      columns += 1;
      fieldStart = true;
      afterQuote = false;
    } else if (character === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
    } else {
      if (afterQuote || character === '"') return false;
      fieldStart = false;
    }
  }
  return rows >= 2;
}

// These are structural hints, not a YAML validator. A lone "Meeting: Friday"
// or a plain bullet list is too ambiguous to call YAML.
function isYaml(source) {
  const lines = source.split('\n');
  let mappings = 0;
  let nested = false;
  let blockIndent = null;
  let explicitDocument = false;
  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^(?:---|\.\.\.)\s*$/.test(line) || /^%YAML\s+\d+\.\d+\s*$/.test(line)) {
      explicitDocument = true;
      continue;
    }
    const indent = line.match(/^ */)[0].length;
    if (blockIndent !== null && indent > blockIndent) continue;
    blockIndent = null;
    if (/^\s*(?:-\s+)?(?:[\w.-]+|"[^"\n]+"|'[^'\n]+'):(?:\s|$)/.test(line)) {
      mappings += 1;
      if (indent > 0) nested = true;
      if (/:[ \t]*[|>][+-]?[ \t]*(?:#.*)?$/.test(line)) blockIndent = indent;
    } else if (mappings > 0 && /^ +-[ \t]+\S/.test(line)) {
      nested = true;
    } else {
      return false;
    }
  }
  return mappings >= 2 || (mappings >= 1 && (nested || explicitDocument));
}

function hasMarkdownBlocks(source) {
  return /^ {0,3}(?:#{1,6}(?:\s|$)|`{3,}|~{3,}|>\s|[-*+]\s+\S|\d+[.)]\s+\S)/m.test(source)
    || /^\S[^\n]*\n {0,3}(?:={3,}|-{3,})[ \t]*$/m.test(source)
    || /^\s*\|?[ \t]*:?-{3,}:?[ \t]*\|[\t |:\-]*$/m.test(source);
}

export function detectNoteFormat(content, Parser = globalThis.DOMParser ?? globalThis.window?.DOMParser) {
  const source = String(content ?? '').replace(/\r\n?/g, '\n').trim();
  if (!source) return 'TXT';
  if (source.startsWith('{') || source.startsWith('[')) {
    try {
      const value = JSON.parse(source);
      if (value !== null && typeof value === 'object') return 'JSON';
    } catch { /* Incomplete JSON is ordinary text until it can be recognized. */ }
  }
  // Parse into a detached XML document, never an HTML document or the live UI.
  // DTDs are outside this detector's scope; do not resolve declared entities.
  if (source.startsWith('<') && !/<!DOCTYPE/i.test(source) && Parser) {
    try {
      if (isXml(source, Parser)) return 'XML';
    } catch { /* Malformed XML stays text. */ }
  }
  if (isYaml(source)) return 'YAML';
  // Check complete CSV records before Markdown hints inside quoted cells.
  if (isCsv(source)) return 'CSV';
  if (hasMarkdownBlocks(source)) return 'MD';
  if (/!?\[[^\]\n]+\]\([^\n)]+\)/.test(source)
    || /(`+)[^`\n]+\1|\*\*\S(?:[^\n]*?\S)?\*\*|__\S(?:[^\n]*?\S)?__|~~\S(?:[^\n]*?\S)?~~/.test(source)
    || /(?:^|\s)([*_])\S(?:[^\n]*?\S)?\1(?=$|[\s.,!?:;])/.test(source)) return 'MD';
  return 'TXT';
}

export function createNoteFormatDetector(Parser) {
  const cache = new WeakMap();
  return note => {
    const previous = cache.get(note);
    if (previous && previous.content === note.content) return previous.format;
    const format = detectNoteFormat(note.content, Parser);
    cache.set(note, { content: note.content, format });
    return format;
  };
}
