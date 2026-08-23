// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { findTextMatches } from "../src/find.js";

test("plain-text find is case-insensitive and includes line context", () => {
  const { matches, invalidPattern } = findTextMatches(
    "Alpha first\nsecond alpha here\nALPHA",
    "alpha"
  );

  assert.equal(invalidPattern, false);
  assert.deepEqual(
    matches.map(({ start, end, text, line, column, snippet }) => ({
      start, end, text, line, column, snippet
    })),
    [
      { start: 0, end: 5, text: "Alpha", line: 1, column: 1, snippet: "Alpha first" },
      { start: 19, end: 24, text: "alpha", line: 2, column: 8, snippet: "second alpha here" },
      { start: 30, end: 35, text: "ALPHA", line: 3, column: 1, snippet: "ALPHA" }
    ]
  );
});

test("regex find supports multiline matches and reports their starting location", () => {
  const { matches } = findTextMatches("first\nsecond\nthird", "first\\nsecond", true);

  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0], {
    start: 0,
    end: 12,
    text: "first\nsecond",
    line: 1,
    column: 1,
    snippet: "first"
  });
});

test("invalid and empty regular expressions are handled safely", () => {
  assert.deepEqual(findTextMatches("text", "[", true), {
    matches: [],
    invalidPattern: true
  });
  assert.deepEqual(findTextMatches("text", "^", true), {
    matches: [],
    invalidPattern: false
  });
});

test("long lines show context around the match", () => {
  const text = `${"before ".repeat(30)}needle${" after".repeat(30)}`;
  const { matches } = findTextMatches(text, "needle");

  assert.equal(matches.length, 1);
  assert.match(matches[0].snippet, /^….*needle.*…$/);
  assert.ok(matches[0].snippet.length < text.length);
});
