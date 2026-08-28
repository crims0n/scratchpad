// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { getTableEnterEdit, getTableTabEdit } from "../src/editor-tables.js";

test("Enter after a header creates a separator and first data row", () => {
  assert.deepEqual(getTableEnterEdit("| A | B |", 9, 9), {
    value: "| A | B |\n| --- | --- |\n|  |  |",
    selectionStart: 26,
    selectionEnd: 26
  });
});

test("Enter at the end of a table row creates another row", () => {
  const value = "| A | B |\n| --- | --- |\n| 1 | 2 |";
  assert.deepEqual(getTableEnterEdit(value, value.length, value.length), {
    value: `${value}\n|  |  |`,
    selectionStart: value.length + 3,
    selectionEnd: value.length + 3
  });
});

test("Tab moves between table cells and skips the separator", () => {
  const value = "| A | B |\n| --- | --- |\n| 1 | 2 |";
  assert.deepEqual(getTableTabEdit(value, 2, 2), {
    value,
    selectionStart: 6,
    selectionEnd: 6
  });
  assert.deepEqual(getTableTabEdit(value, 6, 6), {
    value,
    selectionStart: 26,
    selectionEnd: 26
  });
});

test("Tab from the final table cell creates a row", () => {
  const value = "| A | B |\n| --- | --- |\n| 1 | 2 |";
  assert.deepEqual(getTableTabEdit(value, 30, 30), {
    value: `${value}\n|  |  |`,
    selectionStart: value.length + 3,
    selectionEnd: value.length + 3
  });
});
