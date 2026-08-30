// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { getMarkdownAutocompleteEdit } from "../src/editor-autocomplete.js";

test("Enter continues unordered lists with their indentation and marker", () => {
  assert.deepEqual(getMarkdownAutocompleteEdit("  - first", 9, 9), {
    value: "  - first\n  - ",
    selectionStart: 14,
    selectionEnd: 14
  });

  assert.deepEqual(getMarkdownAutocompleteEdit("* first", 7, 7), {
    value: "* first\n* ",
    selectionStart: 10,
    selectionEnd: 10
  });
});

test("Enter increments ordered lists and preserves their delimiter", () => {
  assert.deepEqual(getMarkdownAutocompleteEdit("9. ninth", 8, 8), {
    value: "9. ninth\n10. ",
    selectionStart: 13,
    selectionEnd: 13
  });

  assert.deepEqual(getMarkdownAutocompleteEdit("1) first", 8, 8), {
    value: "1) first\n2) ",
    selectionStart: 12,
    selectionEnd: 12
  });
});

test("Enter continues task lists with an unchecked item", () => {
  assert.deepEqual(getMarkdownAutocompleteEdit("- [x] done", 10, 10), {
    value: "- [x] done\n- [ ] ",
    selectionStart: 17,
    selectionEnd: 17
  });
});

test("Enter on an empty list item outdents, then exits the list", () => {
  assert.deepEqual(getMarkdownAutocompleteEdit("- first\n- ", 10, 10), {
    value: "- first\n\n",
    selectionStart: 8,
    selectionEnd: 8
  });

  assert.deepEqual(getMarkdownAutocompleteEdit("  - [ ] ", 8, 8), {
    value: "- [ ] ",
    selectionStart: 6,
    selectionEnd: 6
  });

  assert.deepEqual(getMarkdownAutocompleteEdit("- [ ]", 5, 5), {
    value: "",
    selectionStart: 0,
    selectionEnd: 0
  });
});

test("Enter preserves unordered marker and spacing styles", () => {
  assert.deepEqual(getMarkdownAutocompleteEdit("+   first", 9, 9), {
    value: "+   first\n+   ",
    selectionStart: 14,
    selectionEnd: 14
  });
});

test("inserting an ordered item renumbers the following siblings", () => {
  assert.deepEqual(getMarkdownAutocompleteEdit("1. first\n2. second\n3. third", 8, 8), {
    value: "1. first\n2. \n3. second\n4. third",
    selectionStart: 12,
    selectionEnd: 12
  });
});

test("Enter continues blockquotes and exits from an empty quote line", () => {
  assert.deepEqual(getMarkdownAutocompleteEdit("> > quoted", 10, 10), {
    value: "> > quoted\n> > ",
    selectionStart: 15,
    selectionEnd: 15
  });

  assert.deepEqual(getMarkdownAutocompleteEdit("> quote\n> ", 10, 10), {
    value: "> quote\n\n",
    selectionStart: 8,
    selectionEnd: 8
  });
});

test("Enter closes fences and preserves indentation inside them", () => {
  assert.deepEqual(getMarkdownAutocompleteEdit("```", 3, 3), {
    value: "```\n\n```",
    selectionStart: 4,
    selectionEnd: 4
  });

  assert.deepEqual(getMarkdownAutocompleteEdit("```js\n  code", 12, 12), {
    value: "```js\n  code\n  ",
    selectionStart: 15,
    selectionEnd: 15
  });

  assert.deepEqual(getMarkdownAutocompleteEdit("> ```", 5, 5), {
    value: "> ```\n> \n> ```",
    selectionStart: 8,
    selectionEnd: 8
  });
});

test("list-looking lines inside fences remain literal code", () => {
  assert.deepEqual(getMarkdownAutocompleteEdit("```\n- code", 10, 10), {
    value: "```\n- code\n",
    selectionStart: 11,
    selectionEnd: 11
  });
});

test("Enter inside inline code does not continue surrounding Markdown", () => {
  assert.equal(getMarkdownAutocompleteEdit("- `code`", 4, 4), null);
});

test("Enter splits a list item at the cursor", () => {
  assert.deepEqual(getMarkdownAutocompleteEdit("- first second", 7, 7), {
    value: "- first\n- second",
    selectionStart: 10,
    selectionEnd: 10
  });
});

test("autocomplete leaves plain lines and selected text to the browser", () => {
  assert.equal(getMarkdownAutocompleteEdit("plain text", 10, 10), null);
  assert.equal(getMarkdownAutocompleteEdit("- selected", 2, 10), null);
});
