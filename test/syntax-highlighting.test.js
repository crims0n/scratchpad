// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { createEditorDecorationBuilder, highlightPreviewCode } from "../src/syntax-highlighting.js";

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL("../src/vendor/highlight.min.js", import.meta.url), "utf8"), context);
const highlighter = context.hljs;
const tokens = (text, options = {}) => createEditorDecorationBuilder()(text, { highlighter, ...options });
const colored = (text, ranges, className) => ranges.filter(range => range.className === className)
  .map(range => text.slice(range.start, range.end));

test("bundled grammars provide source ranges for JSON, XML, and YAML", () => {
  const json = '{"name":"<unsafe>😀", "count":42, "enabled":true, "items":null}';
  const ranges = tokens(json, { format: "JSON" });
  assert.equal(colored(json, ranges, "syntax-key")[0], '"name"');
  assert.equal(colored(json, ranges, "syntax-string")[0], '"<unsafe>😀"');
  assert.deepEqual(colored(json, ranges, "syntax-number"), ["42"]);
  assert.deepEqual(colored(json, ranges, "syntax-literal"), ["true", "null"]);
  const xml = '<note enabled="true"><!-- comment --><text>&amp;😀</text></note>';
  const xmlRanges = tokens(xml, { format: "XML" });
  assert.deepEqual(colored(xml, xmlRanges, "syntax-key"), ["enabled"]);
  assert.deepEqual(colored(xml, xmlRanges, "syntax-comment"), ["<!-- comment -->"]);
  assert.ok(colored(xml, xmlRanges, "syntax-tag").length);
  const yaml = 'name: Scratchpad\r\nenabled: true\r\ncount: 42\r\n# comment\r\n';
  const yamlRanges = tokens(yaml, { format: "YAML" });
  assert.equal(colored(yaml, yamlRanges, "syntax-key")[0], "name:");
  assert.deepEqual(colored(yaml, yamlRanges, "syntax-literal"), ["true"]);
  assert.deepEqual(colored(yaml, yamlRanges, "syntax-number"), ["42"]);
  assert.deepEqual(colored(yaml, yamlRanges, "syntax-comment"), ["# comment"]);
});

test("CSV colors repeat by column, respecting quoted commas, escaped quotes, and multiline cells", () => {
  const text = 'name,description,count,extra\r\nAlice,"Hello, ""world""\n# heading",42,tail\r\n';
  const ranges = tokens(text, { format: "CSV" });
  assert.deepEqual(colored(text, ranges, "syntax-csv-0"), ["name", "extra", "Alice", "tail"]);
  assert.deepEqual(colored(text, ranges, "syntax-csv-1"), ["description", '"Hello, ""world""\n# heading"']);
  assert.deepEqual(colored(text, ranges, "syntax-csv-2"), ["count", "42"]);
  assert.equal(colored(text, ranges, "syntax-punctuation").length, 6);
  assert.deepEqual(colored(text, ranges, "syntax-heading"), []);
});

test("TXT and disabled syntax stay plain while Find and Compare keep source offsets", () => {
  for (const options of [{ format: "TXT" }, { format: "JSON", syntaxEnabled: false }]) {
    const text = '# **literal** <unsafe>';
    const ranges = tokens(text, { ...options,
      matches: [{ start: 3, end: 10 }], activeMatchIndex: 0,
      decorations: [{ start: 3, end: 10, className: "diff-text-added" }]
    });
    assert.equal(ranges.some(range => range.className.startsWith("syntax-")), false);
    assert.equal(colored(text, ranges, "find-match active-match")[0], "*litera");
    assert.deepEqual(colored(text, ranges, "diff-text-added"), ["*litera"]);
  }
});

test("structured syntax, Find, and Compare retain independent UTF-16 ranges", () => {
  const text = '{"emoji":"😀", "count":42}';
  const start = text.indexOf("42");
  const ranges = tokens(text, { format: "JSON", matches: [{ start, end: start + 2 }], activeMatchIndex: 0,
    decorations: [{ start: start + 1, end: start + 2, className: "diff-text-added" }]
  });
  assert.deepEqual(colored(text, ranges, "syntax-number"), ["42"]);
  assert.deepEqual(colored(text, ranges, "find-match active-match"), ["42"]);
  assert.deepEqual(colored(text, ranges, "diff-text-added"), ["2"]);
});

test("missing, failing, or unexpected highlighter output falls back to uncolored source", () => {
  for (const faulty of [
    {},
    { getLanguage: () => true, highlight: () => { throw new Error("failed"); } },
    { getLanguage: () => true, highlight: () => ({ value: "changed" }) },
    { getLanguage: () => true, highlight: () => ({ value: '<img onerror="alert(1)">&lt;unsafe&gt;' }) },
    { getLanguage: () => true, highlight: () => ({ value: '<span class="hljs-tag">&lt;unsafe&gt;' }) },
    { getLanguage: () => true, highlight: () => ({ value: '&lt;unsafe&gt;</span>' }) },
    { getLanguage: () => true, highlight: () => ({ value: '<span class="hljs-tag" onclick="alert(1)">&lt;unsafe&gt;</span>' }) }
  ]) assert.deepEqual(tokens("<unsafe>", { format: "XML", highlighter: faulty }), []);
});

test("entity decoding preserves literal ampersands, quotes, Unicode, and whitespace", () => {
  const text = JSON.stringify({ value: "' & < > \" &lt; \r \n \t 😀" });
  assert.deepEqual(colored(text, tokens(text, { format: "JSON" }), "syntax-string"), [text.slice(text.indexOf(":") + 1, -1)]);
});

test("per-pane cache avoids parsing unchanged text and invalidates on edits, formats, and toggles", () => {
  let calls = 0;
  const counting = {
    getLanguage: language => highlighter.getLanguage(language),
    highlight: (text, options) => { calls += 1; return highlighter.highlight(text, options); }
  };
  const primary = createEditorDecorationBuilder(), secondary = createEditorDecorationBuilder();
  const options = { format: "JSON", highlighter: counting }, text = '{"count":42}';
  assert.deepEqual(primary(text, options), primary(text, options));
  primary(text, { ...options, matches: [{ start: 9, end: 11 }], decorations: [{ start: 9, end: 11, className: "diff-text-added" }] });
  assert.equal(calls, 1);
  secondary(text, options); assert.equal(calls, 2);
  primary('{"count":43}', options); assert.equal(calls, 3);
  primary('{"count":43}', { ...options, format: "YAML" }); assert.equal(calls, 4);
  primary(text, { ...options, syntaxEnabled: false }); assert.equal(calls, 4);
  primary(text, options); assert.equal(calls, 5);
});

test("Markdown syntax ranges color headings, inline markup, and fenced code", () => {
  const text = "# Heading\n- [ ] A **strong** [link](https://example.com)\n```js\nconst answer = 42;\n```";
  const ranges = tokens(text, { format: "MD" });
  assert.deepEqual(colored(text, ranges, "syntax-heading"), ["Heading"]);
  assert.deepEqual(colored(text, ranges, "syntax-emphasis"), ["**strong**"]);
  assert.deepEqual(colored(text, ranges, "syntax-link"), ["[link](https://example.com)"]);
  assert.deepEqual(colored(text, ranges, "syntax-code-block"), ["const answer = 42;"]);
});

test("presentation ranges clamp offsets and discard unsupported decoration classes", () => {
  const text = "# changed heading";
  const ranges = tokens(text, { matches: [{ start: -5, end: 9 }, { start: NaN, end: 10 }], activeMatchIndex: 0,
    decorations: [
      { start: 0, end: Infinity, className: "diff-line-removed" },
      { start: 2, end: 9, className: "diff-text-removed" },
      { start: 0, end: 2, className: 'unsafe" onclick="alert(1)' }
    ]
  });
  assert.ok(ranges.every(range => range.start >= 0 && range.end <= text.length && range.end > range.start));
  assert.deepEqual(colored(text, ranges, "find-match active-match"), ["# changed"]);
  assert.deepEqual(colored(text, ranges, "diff-line-removed"), [text]);
  assert.deepEqual(colored(text, ranges, "diff-text-removed"), ["changed"]);
  assert.equal(ranges.some(range => range.className.includes("onclick")), false);
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
