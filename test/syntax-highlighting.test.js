// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";

import { highlightPreviewCode, renderEditorBackdrop } from "../src/syntax-highlighting.js";

test("editor highlighting colors Markdown without changing its text", () => {
  const markdown = [
    "# Heading",
    "- [ ] A **strong** [link](https://example.com)",
    "```js",
    "const answer = 42;",
    "```"
  ].join("\n");
  const html = renderEditorBackdrop(markdown);
  const dom = new JSDOM(`<div id="backdrop">${html}</div>`);
  const backdrop = dom.window.document.getElementById("backdrop");

  assert.equal(backdrop.textContent, `${markdown}\n`);
  assert.equal(backdrop.querySelector(".syntax-heading").textContent, "Heading");
  assert.equal(backdrop.querySelector(".syntax-emphasis").textContent, "**strong**");
  assert.equal(backdrop.querySelector(".syntax-link").textContent, "[link](https://example.com)");
  assert.equal(backdrop.querySelector(".syntax-code-block").textContent, "const answer = 42;");
});

test("editor highlighting composes safely with find matches and can be disabled", () => {
  const text = "# <unsafe> heading";
  const enabled = renderEditorBackdrop(text, {
    matches: [{ start: 2, end: 10 }],
    activeMatchIndex: 0
  });
  const disabled = renderEditorBackdrop(text, { syntaxEnabled: false });

  assert.match(enabled, /<mark class="active-match">/);
  assert.match(enabled, /&lt;unsafe/);
  assert.match(enabled, /syntax-heading/);
  assert.doesNotMatch(disabled, /syntax-/);

  const dom = new JSDOM(`<div>${enabled}</div>`);
  assert.equal(dom.window.document.querySelector("div").textContent, `${text}\n`);
});

test("editor highlighting composes diff decorations with syntax and find matches", () => {
  const text = "# changed heading";
  const html = renderEditorBackdrop(text, {
    matches: [{ start: 2, end: 9 }],
    activeMatchIndex: 0,
    decorations: [
      { start: 0, end: text.length, className: "diff-line-removed" },
      { start: 2, end: 9, className: "diff-text-removed" },
      { start: 0, end: 2, className: 'unsafe\" onclick="alert(1)' }
    ]
  });
  const dom = new JSDOM(`<div id="backdrop">${html}</div>`);
  const backdrop = dom.window.document.getElementById("backdrop");

  assert.equal(backdrop.textContent, `${text}\n`);
  assert.equal(backdrop.querySelector("mark.active-match").textContent, "changed");
  assert.equal(backdrop.querySelector(".syntax-heading").textContent, "changed");
  assert.equal(backdrop.querySelector(".diff-text-removed").textContent, "changed");
  assert.doesNotMatch(html, /onclick/);
});

test("preview highlighting only processes supported, explicitly labeled fences", () => {
  const dom = new JSDOM(`
    <main>
      <pre><code class="language-js">const value = &lt;unsafe&gt;;</code></pre>
      <pre><code class="language-madeup">plain</code></pre>
      <pre><code>unlabeled</code></pre>
    </main>
  `);
  const calls = [];
  const highlighter = {
    getLanguage: (language) => language === "js",
    highlight: (code, options) => {
      calls.push({ code, options });
      return { value: '<span class="hljs-keyword">const</span> value = &lt;unsafe&gt;;' };
    }
  };
  const container = dom.window.document.querySelector("main");

  assert.equal(highlightPreviewCode(container, highlighter), 1);
  assert.deepEqual(calls, [{
    code: "const value = <unsafe>;",
    options: { language: "js", ignoreIllegals: true }
  }]);
  assert.equal(container.querySelector(".language-js").classList.contains("hljs"), true);
  assert.equal(container.querySelector(".hljs-keyword").textContent, "const");
  assert.equal(container.querySelector(".language-madeup").textContent, "plain");
});
