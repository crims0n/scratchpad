// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { JSDOM } from "jsdom";

import { createEditorBackdropRenderer, highlightPreviewCode, renderEditorBackdrop } from "../src/syntax-highlighting.js";

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL("../src/vendor/highlight.min.js", import.meta.url), "utf8"), context);
const highlighter = context.hljs;
const document = new JSDOM("").window.document;

function backdropFor(text, options = {}) {
  const element = document.createElement("div");
  element.innerHTML = renderEditorBackdrop(text, { highlighter, ...options });
  assert.equal(element.textContent, `${text}\n`);
  return element;
}

test("bundled grammars color JSON, XML, and YAML without altering source", () => {
  const json = backdropFor('{"name":"<unsafe>😀", "count":42, "enabled":true, "items":null}', { format: "JSON" });
  assert.equal(json.querySelector(".syntax-key").textContent, '"name"');
  assert.equal(json.querySelector(".syntax-string").textContent, '"<unsafe>😀"');
  assert.equal(json.querySelector(".syntax-number").textContent, "42");
  assert.equal(json.querySelector(".syntax-literal").textContent, "true");
  assert.equal(json.querySelector("unsafe"), null);
  const xml = backdropFor('<note enabled="true"><!-- comment --><text>&amp;😀</text></note>', { format: "XML" });
  assert.equal(xml.querySelector(".syntax-key").textContent, "enabled");
  assert.equal(xml.querySelector(".syntax-comment").textContent, "<!-- comment -->");
  assert.ok(xml.querySelector(".syntax-tag"));
  assert.equal(xml.querySelector("note"), null);
  const yaml = backdropFor('name: Scratchpad\r\nenabled: true\r\ncount: 42\r\n# comment\r\n', { format: "YAML" });
  assert.equal(yaml.querySelector(".syntax-key").textContent, "name:");
  assert.equal(yaml.querySelector(".syntax-literal").textContent, "true");
  assert.equal(yaml.querySelector(".syntax-number").textContent, "42");
  assert.equal(yaml.querySelector(".syntax-comment").textContent, "# comment");
});

test("CSV colors repeat by column, preserving quoted commas, escaped quotes, and multiline cells", () => {
  const text = 'name,description,count,extra\r\nAlice,"Hello, ""world""\n# heading",42,tail\r\n';
  const backdrop = backdropFor(text, { format: "CSV" });
  assert.deepEqual([...backdrop.querySelectorAll(".syntax-csv-0")].map(node => node.textContent), ["name", "extra", "Alice", "tail"]);
  assert.deepEqual([...backdrop.querySelectorAll(".syntax-csv-1")].map(node => node.textContent), ["description", '"Hello, ""world""\n# heading"']);
  assert.deepEqual([...backdrop.querySelectorAll(".syntax-csv-2")].map(node => node.textContent), ["count", "42"]);
  assert.equal(backdrop.querySelectorAll(".syntax-punctuation").length, 6);
  assert.equal(backdrop.querySelector(".syntax-heading"), null);
});

test("TXT and disabled syntax stay plain while find and comparison remain visible", () => {
  for (const options of [{ format: "TXT" }, { format: "JSON", syntaxEnabled: false }]) {
    const backdrop = backdropFor('# **literal** <unsafe>', {
      ...options, matches: [{ start: 3, end: 10 }], activeMatchIndex: 0,
      decorations: [{ start: 3, end: 10, className: "diff-text-added" }]
    });
    assert.equal(backdrop.querySelector('[class^="syntax-"]'), null);
    assert.equal(backdrop.querySelector("mark.active-match").textContent, "*litera");
    assert.ok(backdrop.querySelector(".diff-text-added"));
  }
});

test("structured tokens compose with Find and Compare using source offsets", () => {
  const text = '{"emoji":"😀", "count":42}';
  const start = text.indexOf("42");
  const backdrop = backdropFor(text, {
    format: "JSON", matches: [{ start, end: start + 2 }], activeMatchIndex: 0,
    decorations: [{ start: start + 1, end: start + 2, className: "diff-text-added" }]
  });
  assert.equal([...backdrop.querySelectorAll("mark")].map(node => node.textContent).join(""), "42");
  assert.equal(backdrop.querySelector(".diff-text-added .syntax-number").textContent, "2");
});

test("missing, failing, or unexpected highlighter output falls back to escaped source", () => {
  for (const faulty of [
    {},
    { getLanguage: () => true, highlight: () => { throw new Error("failed"); } },
    { getLanguage: () => true, highlight: () => ({ value: "changed" }) },
    { getLanguage: () => true, highlight: () => ({ value: '<img onerror="alert(1)">&lt;unsafe&gt;' }) },
    { getLanguage: () => true, highlight: () => ({ value: '<span class="hljs-tag">&lt;unsafe&gt;' }) },
    { getLanguage: () => true, highlight: () => ({ value: '&lt;unsafe&gt;</span>' }) },
    { getLanguage: () => true, highlight: () => ({ value: '<span class="hljs-tag" onclick="alert(1)">&lt;unsafe&gt;</span>' }) }
  ]) {
    const backdrop = backdropFor("<unsafe>", { format: "XML", highlighter: faulty });
    assert.equal(backdrop.querySelector("*"), null);
  }
});

test("entity decoding preserves literal ampersands, quotes, Unicode, and whitespace", () => {
  const text = JSON.stringify({ value: "' & < > \" &lt; \r \n \t 😀" });
  const backdrop = backdropFor(text, { format: "JSON" });
  assert.equal(backdrop.querySelector(".syntax-string").textContent, text.slice(text.indexOf(":") + 1, -1));
});

test("per-pane cache avoids parsing unchanged text and invalidates on edits, formats, and toggles", () => {
  let calls = 0;
  const counting = {
    getLanguage: language => highlighter.getLanguage(language),
    highlight: (text, options) => { calls += 1; return highlighter.highlight(text, options); }
  };
  const primary = createEditorBackdropRenderer();
  const secondary = createEditorBackdropRenderer();
  const options = { format: "JSON", highlighter: counting };
  const text = '{"count":42}';
  const plain = primary(text, options);
  assert.equal(primary(text, options), plain);
  primary(text, { ...options, matches: [{ start: 9, end: 11 }], decorations: [{ start: 9, end: 11, className: "diff-text-added" }] });
  assert.equal(calls, 1);
  secondary(text, options);
  assert.equal(calls, 2);
  primary('{"count":43}', options);
  assert.equal(calls, 3);
  primary('{"count":43}', { ...options, format: "YAML" });
  assert.equal(calls, 4);
  primary(text, { ...options, syntaxEnabled: false });
  assert.equal(calls, 4);
  primary(text, options);
  assert.equal(calls, 5);
});

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
