// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { marked } from "marked";
import {
  isSafeMarkdownUrl,
  renderMarkdown,
  sanitizeMarkdownHtml
} from "../src/markdown.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.document = dom.window.document;

test("sanitizer removes active content and event handlers", () => {
  const html = sanitizeMarkdownHtml(
    '<p onclick="alert(1)">safe<script>alert(2)</script><iframe src="https://example.com">hidden</iframe></p>'
  );

  assert.equal(html, "<p>safe</p>");
});

test("sanitizer restricts links and isolates safe external links", () => {
  const unsafe = sanitizeMarkdownHtml('<a href="javascript:alert(1)">bad</a>');
  const safe = sanitizeMarkdownHtml('<a href="https://example.com">good</a>');

  assert.equal(unsafe, "<a>bad</a>");
  assert.match(safe, /href="https:\/\/example\.com"/);
  assert.match(safe, /target="_blank"/);
  assert.match(safe, /rel="noopener noreferrer"/);
});

test("remote images are blocked while supported embedded images remain", () => {
  const remote = sanitizeMarkdownHtml('<img src="https://example.com/tracker.png">');
  const embedded = sanitizeMarkdownHtml('<img src="data:image/png;base64,AA==" alt="embedded">');

  assert.equal(remote, "");
  assert.match(embedded, /^<img src="data:image\/png;base64,AA=="/);
});

test("checkboxes are always disabled", () => {
  const html = sanitizeMarkdownHtml('<input type="checkbox" checked>');
  assert.match(html, /disabled/);
});

test("rendered Markdown passes through the sanitizer", () => {
  const html = renderMarkdown('[unsafe](javascript:alert(1))\n\n<script>alert(2)</script>', "", marked);

  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /script/i);
});

test("URL policy rejects obfuscated active schemes", () => {
  assert.equal(isSafeMarkdownUrl("java\nscript:alert(1)"), false);
  assert.equal(isSafeMarkdownUrl("https://example.com"), true);
  assert.equal(isSafeMarkdownUrl("https://example.com/image.png", true), false);
});
