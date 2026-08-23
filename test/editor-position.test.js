// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { getCursorPosition } from "../src/editor-position.js";

test("cursor positions are one-based across lines", () => {
  assert.deepEqual(getCursorPosition("first\nsecond", 0, 0), { line: 1, column: 1 });
  assert.deepEqual(getCursorPosition("first\nsecond", 8, 8), { line: 2, column: 3 });
  assert.deepEqual(getCursorPosition("first\n", 6, 6), { line: 2, column: 1 });
});

test("a selection reports its active end", () => {
  const text = "first\nsecond";

  assert.deepEqual(getCursorPosition(text, 6, 10, "forward"), { line: 2, column: 5 });
  assert.deepEqual(getCursorPosition(text, 6, 10, "backward"), { line: 2, column: 1 });
});

test("cursor offsets are clamped to the document", () => {
  assert.deepEqual(getCursorPosition("text", 99, 99), { line: 1, column: 5 });
});
