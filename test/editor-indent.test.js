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

test("Tab indents the whole current Markdown list item", () => {
  assert.deepEqual(getIndentEdit("- parent\n- child", 11, 11), {
    value: "- parent\n\t- child",
    selectionStart: 12,
    selectionEnd: 12
  });

  assert.deepEqual(getIndentEdit("1. parent\n2. child", 13, 13), {
    value: "1. parent\n\t1. child",
    selectionStart: 14,
    selectionEnd: 14
  });
});

test("Tab in list content is literal and list indentation carries children", () => {
  assert.deepEqual(getIndentEdit("- parent\n    - child\n        detail\n- next", 4, 4), {
    value: "- pa\trent\n    - child\n        detail\n- next",
    selectionStart: 5,
    selectionEnd: 5
  });

  assert.deepEqual(getIndentEdit("- parent\n    - child\n        detail\n- next", 2, 2), {
    value: "\t- parent\n\t    - child\n\t        detail\n- next",
    selectionStart: 3,
    selectionEnd: 3
  });
});

test("Tab treats list-looking text inside a fence as code", () => {
  assert.deepEqual(getIndentEdit("```\n- code\n```", 6, 6), {
    value: "```\n- \tcode\n```",
    selectionStart: 7,
    selectionEnd: 7
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
