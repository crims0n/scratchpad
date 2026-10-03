// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { getFormatFoldRanges, editorFolding, foldingFormatEffect, getEditorFolds, MAX_FOLD_CHARACTERS, MAX_FOLD_LINES } from "../src/editor-folding.js";
import { EditorState, foldEffect, markdownParser, jsonParser, xmlParser, yamlParser } from "../src/vendor/codemirror.js";

function sections(source, format) {
  return getFormatFoldRanges(source, format).map(range => ({
    line: source.slice(0, range.from).split("\n").length,
    text: source.slice(range.from, range.to)
  }));
}

test("Markdown headings include subsections and stop before peers; fences contain fake headings", () => {
  const source = "# Top\nintro\n## Child\nbody\n```js\n# fake\n```\n# Next\nrest";
  assert.deepEqual(sections(source, "MD"), [
    { line: 1, text: "\nintro\n## Child\nbody\n```js\n# fake\n```" },
    { line: 3, text: "\nbody\n```js\n# fake\n```" },
    { line: 5, text: "\n# fake\n```" },
    { line: 8, text: "\nrest" }
  ]);
  assert.deepEqual(sections("One\n===\nbody\n\nTwo\n===\nlast", "MD"), [
    { line: 2, text: "\nbody\n" }, { line: 6, text: "\nlast" }
  ]);
  assert.deepEqual(sections("```js\nunclosed\n# fake", "MD"), []);
  assert.deepEqual(sections("~~~\n```\n~~~", "MD"), [{ line: 1, text: "\n```\n~~~" }]);
  assert.deepEqual(sections("> # First\n> body\n> # Second\n> next\n\noutside", "MD"), [
    { line: 1, text: "\n> body" }, { line: 3, text: "\n> next" }
  ]);
  assert.deepEqual(sections("# First\nbody\n  # Second\nnext", "MD"), [
    { line: 1, text: "\nbody" }, { line: 3, text: "\nnext" }
  ]);
});

test("JSON folds multiline objects/arrays and ignores escaped strings and inline objects", () => {
  const source = '{\n  "x": [\n    {"k": "} [ \\\""},\n    2\n  ]\n}';
  assert.deepEqual(sections(source, "JSON"), [
    { line: 1, text: source.slice(1, -1) },
    { line: 2, text: '\n    {"k": "} [ \\\""},\n    2\n  ' }
  ]);
  assert.deepEqual(sections('{"inline": [1, 2]}', "JSON"), []);
  assert.deepEqual(sections('{\n "a": [1, 2]\n', "JSON"), []);
  assert.deepEqual(sections('{\n "a": 1,\n}', "JSON"), []);
});

test("XML folds matching elements, ignoring comments, CDATA, and self-closing tags", () => {
  const source = '<root attr="a>b">\n<!-- <fake> -->\n<child>\n<![CDATA[<fake>]]>\n</child>\n<empty/>\n</root>';
  assert.deepEqual(sections(source, "XML"), [
    { line: 1, text: source.slice(source.indexOf("\n"), source.lastIndexOf("</root>")) },
    { line: 3, text: "\n<![CDATA[<fake>]]>\n" }
  ]);
  assert.deepEqual(sections("<root>\n<a>\ntext\n</b>\n</root>", "XML"), []);
  assert.deepEqual(sections("<root>\nmissing close", "XML"), []);
  assert.deepEqual(sections("<root/>\n<!-- comment -->", "XML"), []);
});

test("YAML folds nested mappings, sequences, scalar blocks, and multiline flow collections", () => {
  const source = "name: Demo\nouter:\n  a: 1\n  list:\n    - one\n    - two\nblock: |\n  fake: key\n  # text\nend: yes";
  assert.deepEqual(sections(source, "YAML"), [
    { line: 2, text: "\n  a: 1\n  list:\n    - one\n    - two" },
    { line: 4, text: "\n    - one\n    - two" },
    { line: 7, text: "\n  fake: key\n  # text" }
  ]);
  assert.deepEqual(sections("list: [\n a, b\n]\nend: yes", "YAML"), [{ line: 1, text: "\n a, b\n" }]);
  assert.deepEqual(sections("a: one\nb: two", "YAML"), []);
});

test("TXT/CSV offer no folds, even with structural-looking source", () => {
  for (const format of ["TXT", "CSV"]) {
    assert.deepEqual(sections('# Heading\nbody\n{\n "a": 1\n}', format), []);
  }
});

test("large-note transactions never invoke fold parsers, even with no folds active", t => {
  for (const [format, parser] of [["MD", markdownParser], ["JSON", jsonParser], ["XML", xmlParser], ["YAML", yamlParser]]) {
    const parse = t.mock.method(parser, "parse", () => { throw new Error("large-note parsing on the edit path"); });
    for (const doc of ["x".repeat(3_000_000), "x\n".repeat(MAX_FOLD_LINES)]) {
      let state = EditorState.create({ doc, extensions: editorFolding() });
      state = state.update({ effects: foldingFormatEffect.of(format) }).state;
      for (let i = 0; i < 5; i++) state = state.update({ changes: { from: 1, insert: "x" } }).state;
      assert.deepEqual(getEditorFolds(state), []);
    }
    assert.equal(parse.mock.callCount(), 0);
    parse.mock.restore();
  }
});

test("moderate pretty-printed JSON and nested YAML retain useful folds beyond 2,000 lines", () => {
  const json = JSON.stringify(Array.from({ length: 1_000 }, () => ({ a: 1, b: 2, c: 3 })), null, 2);
  const yaml = Array.from({ length: 1_000 }, (_, index) => `item${index}:\n  a: 1\n  b: 2\n  c: 3`).join("\n");
  for (const [format, source] of [["JSON", json], ["YAML", yaml]]) {
    const doc = EditorState.create({ doc: source }).doc;
    assert.ok(doc.lines > 2_000 && doc.lines < MAX_FOLD_LINES);
    assert.ok(doc.length < MAX_FOLD_CHARACTERS);
    assert.ok(getFormatFoldRanges(doc, format).length >= 1_000);
  }
});

test("crossing either folding limit expands folds and shrinking restores candidates", () => {
  for (const doc of ["# Heading\n" + "x".repeat(MAX_FOLD_CHARACTERS - 10), "# Heading\n" + "x\n".repeat(MAX_FOLD_LINES - 2) + "x"]) {
    let state = EditorState.create({ doc, extensions: editorFolding() });
    state = state.update({ effects: foldingFormatEffect.of("MD") }).state;
    const [range] = getFormatFoldRanges(state.doc, "MD");
    assert.ok(range);
    state = state.update({ effects: foldEffect.of(range) }).state;
    assert.equal(getEditorFolds(state).length, 1);
    state = state.update({ changes: { from: doc.length, insert: "\nx" } }).state;
    assert.deepEqual(getEditorFolds(state), []);
    assert.deepEqual(getFormatFoldRanges(state.doc, "MD"), []);
    state = state.update({ changes: { from: doc.length, to: state.doc.length } }).state;
    assert.equal(getFormatFoldRanges(state.doc, "MD").length, 1);
  }
});
