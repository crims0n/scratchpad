// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import { marked } from "marked";
import { buildNoteHtml, htmlExportFilename } from "../src/note-html-export.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.document = dom.window.document;
// Use the actual vendored highlighter, including its escaping behavior.
const highlightSource = await readFile(new URL("../src/vendor/highlight.min.js", import.meta.url), "utf8");
const highlightingDom = new JSDOM("", { runScripts: "outside-only" });
highlightingDom.window.eval(highlightSource);
const highlighter = highlightingDom.window.hljs;
const build = options => buildNoteHtml({ markedApi: marked, highlighter, ...options });

test("HTML is a standalone styled document with preview formatting and real syntax highlighting", () => {
  const html = build({ title: "Résumé & <notes>", content: [
    "# Heading", "", "A **strong** and *emphasized* paragraph with ~~deletion~~.", "",
    "> Quote", "", "1. Ordered", "2. List", "", "- [x] Done", "- [ ] Todo", "",
    "| Left | Right |", "| :--- | ---: |", "| value | 42 |", "",
    "```js", "const value = '<unsafe>';", "```", "",
    "[Docs](https://example.com)", "", "![embedded](data:image/png;base64,AA==)"
  ].join("\n") });
  const doc = new JSDOM(html).window.document;
  assert.ok(html.startsWith("<!DOCTYPE html>"));
  assert.equal(doc.title, "Résumé & <notes>");
  assert.equal(doc.querySelector("h1").textContent, "Heading");
  assert.equal(doc.querySelector("strong").textContent, "strong");
  assert.ok(doc.querySelector("em") && doc.querySelector("del") && doc.querySelector("blockquote"));
  assert.equal(doc.querySelectorAll("ol li").length, 2);
  assert.equal(doc.querySelectorAll(".task-list-item input[disabled]").length, 2);
  assert.equal(doc.querySelectorAll("table td").length, 2);
  assert.equal(doc.querySelector("td[align=right]").textContent, "42");
  assert.equal(doc.querySelector("pre code").textContent, "const value = '<unsafe>';\n");
  assert.ok(doc.querySelector(".hljs-keyword"));
  assert.equal(doc.querySelector("img").hasAttribute("loading"), false);
  assert.equal(doc.querySelector("a").rel, "noopener noreferrer");
  assert.equal(doc.querySelectorAll("script, link, iframe, mark, #app").length, 0);
  assert.match(doc.querySelector("style").textContent, /li\.task-list-item/);
  assert.match(doc.querySelector("style").textContent, /\.hljs-keyword/);
  assert.match(doc.querySelector("style").textContent, /@media print/);
  assert.match(doc.querySelector("style").textContent, /--preview-code-bg: #f1f5f9/);
  assert.match(doc.querySelector("style").textContent, /thead \{ display: table-header-group/);
  assert.match(doc.querySelector("style").textContent, /white-space: pre-wrap/);
  assert.doesNotMatch(doc.querySelector("style").textContent, /url\(|@import/);
  assert.match(doc.querySelector('meta[http-equiv="Content-Security-Policy"]').content, /default-src 'none'/);
});

test("note content, title and theme cannot inject scripts, remote assets, or unsafe HTML", () => {
  const html = build({ title: '</title><script>alert(1)</script>', content:
    '<script>alert(2)</script><style>body{display:none}</style><iframe src="https://example.com"></iframe>' +
    '<p onclick="alert(3)">safe<mark class="find-preview-match">text</mark></p>' +
    '<img src="https://example.com/tracker"><img src="file:///private/secret">' +
    '<img src="data:image/svg+xml;base64,AA=="><a href="javascript:alert(4)">bad</a>',
    colors: { "--preview-bg": '</style><script>alert(5)</script>',
      "--accent-color": { rgb: ["0);background:url(https://example.com)", 0, 0], alpha: 1 } }
  });
  const doc = new JSDOM(html).window.document;
  assert.equal(doc.title, '</title><script>alert(1)</script>');
  assert.equal(doc.querySelectorAll("script, iframe, img, mark, [onclick]").length, 0);
  assert.equal(doc.querySelectorAll("style").length, 1);
  assert.equal(doc.querySelector("a").hasAttribute("href"), false);
  assert.equal(doc.querySelector("article").textContent, "safetextbad");
  assert.doesNotMatch(doc.querySelector("style").textContent, /alert|url\(/);
});

test("export retains resolved theme colours, but not app CSS or find decorations", () => {
  const doc = new JSDOM(build({ content: "# Theme", colors: {
    "--preview-bg": { rgb: [9, 13, 22], alpha: 1 },
    "--preview-text": { rgb: [229, 231, 235], alpha: .8 }
  } })).window.document;
  assert.match(doc.querySelector("style").textContent, /--preview-bg: rgba\(9, 13, 22, 1\)/);
  assert.match(doc.querySelector("style").textContent, /--preview-text: rgba\(229, 231, 235, 0\.8\)/);
  assert.doesNotMatch(doc.querySelector("style").textContent, /find-preview|sidebar|editor-textarea/);
});

test("empty notes stay empty, highlighting follows the setting, and missing parser is an error", () => {
  assert.equal(new JSDOM(build({ content: "" })).window.document.querySelector("article").textContent, "");
  const doc = new JSDOM(build({ content: "```js\nconst a = 1;\n```", syntaxHighlighting: false })).window.document;
  assert.equal(doc.querySelectorAll(".hljs, span").length, 0);
  assert.equal(doc.querySelector("code").textContent, "const a = 1;\n");
  assert.throws(() => build({ markedApi: null }), /parser is unavailable/);
});

test("filenames preserve Unicode but reject paths, Windows reserved names and empty stems", () => {
  assert.equal(htmlExportFilename("Résumé 日本語 / notes"), "Résumé-日本語-notes.html");
  assert.equal(htmlExportFilename("../../folder\\name:<file>?"), "folder-name-file.html");
  assert.equal(htmlExportFilename("CON"), "note-CON.html");
  assert.equal(htmlExportFilename("..."), "note.html");
  assert.ok(htmlExportFilename("x".repeat(200)).length <= 85);
});
