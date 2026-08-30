// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import {
  getListMoveEdit,
  getMarkdownPasteEdit,
  getSmartKeyEdit
} from "../src/editor-smart.js";

test("opening characters pair and existing closing characters are skipped", () => {
  assert.deepEqual(getSmartKeyEdit("", 0, 0, "("), {
    value: "()",
    selectionStart: 1,
    selectionEnd: 1
  });
  assert.deepEqual(getSmartKeyEdit("()", 1, 1, ")"), { moveTo: 2 });
});

test("Alt+Up and Alt+Down move list subtrees and renumber ordered siblings", () => {
  const unordered = "- first\n- second\n    - child\n- third";
  assert.deepEqual(getListMoveEdit(unordered, 12, 12, -1), {
    value: "- second\n    - child\n- first\n- third",
    selectionStart: 4,
    selectionEnd: 4
  });

  const ordered = "1. first\n2. second\n3. third";
  assert.deepEqual(getListMoveEdit(ordered, 3, 3, 1), {
    value: "1. second\n2. first\n3. third",
    selectionStart: 13,
    selectionEnd: 13
  });
});

test("Backspace deletes an empty pair together", () => {
  assert.deepEqual(getSmartKeyEdit("()", 1, 1, "Backspace"), {
    value: "",
    selectionStart: 0,
    selectionEnd: 0
  });
});

test("Markdown delimiters wrap selected text", () => {
  assert.deepEqual(getSmartKeyEdit("word", 0, 4, "*"), {
    value: "*word*",
    selectionStart: 1,
    selectionEnd: 5
  });
  assert.deepEqual(getSmartKeyEdit("word", 0, 4, "~"), {
    value: "~~word~~",
    selectionStart: 2,
    selectionEnd: 6
  });
});

test("escaped triggers and ordinary pairs inside code are left literal", () => {
  assert.equal(getSmartKeyEdit("\\", 1, 1, "("), null);
  assert.equal(getSmartKeyEdit("```\ncode", 8, 8, "("), null);
});

test("Backspace at list content removes the marker", () => {
  assert.deepEqual(getSmartKeyEdit("- [ ] child", 6, 6, "Backspace"), {
    value: "child",
    selectionStart: 0,
    selectionEnd: 0
  });
});

test("pasting a URL over text creates a Markdown link", () => {
  assert.deepEqual(getMarkdownPasteEdit("OpenAI", 0, 6, "https://openai.com"), {
    value: "[OpenAI](https://openai.com)",
    selectionStart: 28,
    selectionEnd: 28
  });
});

test("pasting a spreadsheet range creates a Markdown table", () => {
  const table = "| Name | Score |\n| --- | --- |\n| Ada | 10 |\n| Lin | 9 |";
  assert.deepEqual(getMarkdownPasteEdit("", 0, 0, "Name\tScore\nAda\t10\nLin\t9"), {
    value: table,
    selectionStart: table.length,
    selectionEnd: table.length
  });
});

test("pasting tab-indented code or ragged rows leaves the text unchanged", () => {
  assert.equal(getMarkdownPasteEdit("", 0, 0, "def f():\n\treturn 42"), null);
  assert.equal(getMarkdownPasteEdit("", 0, 0, "\tfoo\n\tbar"), null);
  assert.equal(getMarkdownPasteEdit("", 0, 0, "Name\tScore\nAda"), null);
});
