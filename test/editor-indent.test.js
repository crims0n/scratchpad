// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { getIndentEdit } from "../src/editor-indent.js";

test("Tab inserts indentation at the cursor", () => {
  assert.deepEqual(getIndentEdit("alphaomega", 5, 5), {
    value: "alpha\tomega",
    selectionStart: 6,
    selectionEnd: 6
  });
});

test("Tab indents every selected line without replacing the selection", () => {
  assert.deepEqual(getIndentEdit("one\ntwo\nthree", 0, 7), {
    value: "\tone\n\ttwo\nthree",
    selectionStart: 1,
    selectionEnd: 9
  });
});

test("Shift+Tab removes tabs or up to four leading spaces", () => {
  assert.deepEqual(getIndentEdit("\tone\n    two\nthree", 1, 13, true), {
    value: "one\ntwo\nthree",
    selectionStart: 0,
    selectionEnd: 8
  });
});
