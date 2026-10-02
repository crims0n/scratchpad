// SPDX-License-Identifier: GPL-3.0-or-later

import { renderMarkdown } from "./markdown.js";
import { highlightPreviewCode } from "./syntax-highlighting.js";

// Only resolved numeric colours enter the stylesheet, never raw theme CSS.
export const HTML_EXPORT_COLORS = Object.freeze({
  "--preview-bg": "#f8fafc",
  "--preview-text": "#1e293b",
  "--text-primary": "#0f172a",
  "--text-secondary": "#575d6a",
  "--accent-color": "#a855f7",
  "--accent-hover": "#7e22ce",
  "--border-color": "#e2e8f0",
  "--preview-code-bg": "#e2e8f0",
  "--preview-quote-bg": "#f1f5f9",
  "--preview-quote-border": "#a855f7",
  "--preview-hr": "#e2e8f0",
  "--syntax-muted": "#64748b",
  "--syntax-string": "#15803d",
  "--syntax-number": "#b45309",
  "--syntax-danger": "#be123c"
});

function exportColors(colors) {
  return Object.entries(HTML_EXPORT_COLORS).map(([property, fallback]) => {
    const color = colors[property];
    const valid = Array.isArray(color?.rgb) && color.rgb.length === 3 &&
      color.rgb.every(channel => Number.isFinite(channel) && channel >= 0 && channel <= 255) &&
      Number.isFinite(color.alpha) && color.alpha >= 0 && color.alpha <= 1;
    const value = valid ? `rgba(${color.rgb.map(Math.round).join(", ")}, ${color.alpha})` : fallback;
    return `${property}: ${value};`;
  }).join("\n");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

export function htmlExportFilename(title) {
  let name = String(title || "note").normalize("NFC")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "")
    .slice(0, 80).replace(/-+$/g, "") || "note";
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name)) name = `note-${name}`;
  return `${name}.html`;
}

// Mirrors the preview's content formatting, without its scrolling container,
// app chrome, find marks, or dependencies on the app's fonts and stylesheets.
const DOCUMENT_STYLES = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: var(--preview-bg); color: var(--preview-text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 1.05rem; line-height: 1.65; overflow-wrap: anywhere;
}
.markdown-preview { max-width: 960px; margin: 0 auto; padding: 24px; }
h1, h2, h3, h4 {
  margin-top: 1.5em; margin-bottom: .5em; font-weight: 700;
  line-height: 1.35; letter-spacing: -.02em; color: var(--text-primary);
}
h1 { font-size: 1.8rem; border-bottom: 1px solid var(--preview-hr); padding-bottom: .3em; margin-top: .5em; }
h2 { font-size: 1.45rem; border-bottom: 1px solid var(--preview-hr); padding-bottom: .3em; }
h3 { font-size: 1.25rem; } h4 { font-size: 1.1rem; }
p, ul, ol { margin-bottom: 1em; }
a { color: var(--accent-color); text-decoration: underline; text-decoration-thickness: 1px; }
a:hover { color: var(--accent-hover); }
ul, ol { padding-left: 20px; } li { margin-bottom: .25em; }
li.task-list-item { list-style: none; }
blockquote {
  border-left: 4px solid var(--preview-quote-border); background: var(--preview-quote-bg);
  padding: 12px 16px; margin-bottom: 1em; border-radius: 0 6px 6px 0;
  color: var(--text-secondary); font-style: italic;
}
pre, code { background: var(--preview-code-bg); font-family: Menlo, Monaco, Consolas, "Courier New", monospace; font-size: .9rem; }
pre { border-radius: 8px; padding: 16px; overflow-x: auto; margin-bottom: 1em; }
code { padding: 2px 6px; border-radius: 4px; }
pre code { background: none; padding: 0; border-radius: 0; font-size: inherit; }
.hljs-comment, .hljs-quote { color: var(--syntax-muted); }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-type { color: var(--accent-color); }
.hljs-string, .hljs-regexp, .hljs-addition, .hljs-attribute { color: var(--syntax-string); }
.hljs-number, .hljs-symbol, .hljs-bullet, .hljs-variable, .hljs-template-variable { color: var(--syntax-number); }
.hljs-title, .hljs-section, .hljs-selector-id, .hljs-selector-class, .hljs-built_in { color: var(--accent-hover); }
.hljs-deletion, .hljs-meta { color: var(--syntax-danger); }
hr { height: 1px; border: none; background: var(--preview-hr); margin: 1.5em 0; }
table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
th, td { border: 1px solid var(--border-color); padding: 8px 12px; text-align: left; }
th { background: var(--preview-quote-bg); font-weight: 600; }
td[align="left"], th[align="left"] { text-align: left; }
td[align="center"], th[align="center"] { text-align: center; }
td[align="right"], th[align="right"] { text-align: right; }
img { max-width: 100%; border-radius: 6px; margin-bottom: 1em; }
@media print {
  :root {
    --preview-bg: white; --preview-text: black; --text-primary: black; --text-secondary: #333;
    --preview-code-bg: #f1f5f9; --preview-quote-bg: #f8fafc; --preview-hr: #cbd5e1;
    --border-color: #cbd5e1; --preview-quote-border: #7e22ce;
    --accent-color: #7e22ce; --accent-hover: #581c87;
    --syntax-muted: #475569; --syntax-string: #166534; --syntax-number: #92400e; --syntax-danger: #9f1239;
  }
  body { background: white; color: black; font-size: 11pt; }
  .markdown-preview { max-width: none; padding: 0; }
  h1, h2, h3, h4, h5, h6 { color: black; break-after: avoid; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; }
  pre, code { font-size: 9pt; }
  blockquote { color: #333; }
  table { table-layout: fixed; }
  thead { display: table-header-group; }
  tr, img { break-inside: avoid; }
  img { max-height: 240mm; object-fit: contain; }
  p { orphans: 3; widows: 3; }
}
`;

export function buildNoteHtml({ title = "Untitled Scratchpad", content = "", colors = {},
  markedApi = globalThis.window?.marked, highlighter = globalThis.window?.hljs,
  syntaxHighlighting = true } = {}) {
  if (!markedApi) throw new Error("Markdown parser is unavailable");
  const container = document.createElement("article");
  container.className = "markdown-preview";
  container.innerHTML = renderMarkdown(content, "", markedApi);
  // Highlight trusted parser output, not user-provided highlighting markup.
  highlightPreviewCode(container, highlighter, syntaxHighlighting);
  // Embedded images must not wait until scrolling before appearing/printing.
  container.querySelectorAll("img").forEach(img => img.removeAttribute("loading"));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>:root { ${exportColors(colors)} }\n${DOCUMENT_STYLES}</style>
</head>
<body>${container.outerHTML}</body>
</html>\n`;
}
