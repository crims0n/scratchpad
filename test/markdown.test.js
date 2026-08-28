// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { marked } from "marked";
import {
  isSafeMarkdownUrl,
  renderMarkdown,
  resolveLinkAction,
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

test("sanitizer does not trust highlight markup from note content", () => {
  const html = sanitizeMarkdownHtml('<mark class="find-preview-match" data-find-index="0">safe</mark>');

  assert.equal(html, "safe");
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

test("task list items are marked so the preview can hide their bullet", () => {
  const html = renderMarkdown("- [ ] todo\n- normal", "", marked);

  assert.match(html, /<li class="task-list-item"><input[^>]+> todo<\/li>/);
  assert.match(html, /<li>normal<\/li>/);
});

test("a parent bullet remains when only its nested child is a task", () => {
  const html = renderMarkdown("- parent\n  - [ ] child", "", marked);

  assert.match(html, /<li>parent<ul>/);
  assert.match(html, /<li class="task-list-item"><input[^>]+> child<\/li>/);
});

test("rendered Markdown passes through the sanitizer", () => {
  const html = renderMarkdown('[unsafe](javascript:alert(1))\n\n<script>alert(2)</script>', "", marked);

  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /script/i);
});

test("preview links route external schemes to the browser", () => {
  assert.deepEqual(resolveLinkAction("https://example.com"), {
    kind: "external",
    url: "https://example.com"
  });
  assert.deepEqual(resolveLinkAction("http://example.com"), {
    kind: "external",
    url: "http://example.com"
  });
  assert.deepEqual(resolveLinkAction("mailto:someone@example.com"), {
    kind: "external",
    url: "mailto:someone@example.com"
  });
});

test("preview links leave in-document anchors alone", () => {
  // Nothing generates heading ids and the sanitizer strips them, so an anchor
  // has no target. What matters is that it is never treated as external.
  assert.deepEqual(resolveLinkAction("#a-heading"), { kind: "ignore" });
});

test("preview links never hand an unsupported scheme to the system", () => {
  const ignored = [
    "javascript:alert(1)",
    "java\nscript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,<script>alert(1)</script>",
    "tel:+15550100",
    "",
    "   ",
    null,
    undefined
  ];

  ignored.forEach((href) => {
    assert.equal(resolveLinkAction(href).kind, "ignore", `expected ${href} to be ignored`);
  });
});

test("URL policy rejects obfuscated active schemes", () => {
  assert.equal(isSafeMarkdownUrl("java\nscript:alert(1)"), false);
  assert.equal(isSafeMarkdownUrl("https://example.com"), true);
  assert.equal(isSafeMarkdownUrl("https://example.com/image.png", true), false);
});
