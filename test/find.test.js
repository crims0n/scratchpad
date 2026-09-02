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

test("match case requires matching capitalization", () => {
  const { matches } = findTextMatches(
    "Alpha first\nsecond alpha here\nALPHA",
    "alpha",
    { matchCase: true }
  );

  assert.deepEqual(matches.map(({ text, line, column }) => ({ text, line, column })), [
    { text: "alpha", line: 2, column: 8 }
  ]);
});

test("case-insensitive plain-text find keeps offsets after expanding lowercase characters", () => {
  const text = "İstanbul trip. Book a hotel, then book a flight.";
  const { matches } = findTextMatches(text, "book");

  assert.deepEqual(
    matches.map(({ start, end, text: matchText, line, column }) => ({
      start,
      end,
      text: matchText,
      line,
      column
    })),
    [
      { start: 15, end: 19, text: "Book", line: 1, column: 16 },
      { start: 34, end: 38, text: "book", line: 1, column: 35 }
    ]
  );
});

test("plain-text find treats regular-expression characters literally", () => {
  const { matches } = findTextMatches("Use [draft] or [final].", "[draft]");

  assert.deepEqual(matches.map(({ start, end, text }) => ({ start, end, text })), [
    { start: 4, end: 11, text: "[draft]" }
  ]);
});

test("exact match excludes results contained within larger words", () => {
  const { matches } = findTextMatches(
    "cat scatter cat2 cat_note cat. Cat",
    "cat",
    { exactMatch: true }
  );

  assert.deepEqual(matches.map(({ text, column }) => ({ text, column })), [
    { text: "cat", column: 1 },
    { text: "cat", column: 27 },
    { text: "Cat", column: 32 }
  ]);
});

test("regex find supports multiline matches and reports their starting location", () => {
  const { matches } = findTextMatches(
    "first\nsecond\nthird",
    "first\\nsecond",
    { useRegex: true }
  );

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

test("match case makes regular expressions case-sensitive", () => {
  const { matches } = findTextMatches(
    "Alpha alpha ALPHA",
    "alpha",
    { useRegex: true, matchCase: true }
  );

  assert.deepEqual(matches.map(({ text }) => text), ["alpha"]);
});

test("invalid and empty regular expressions are handled safely", () => {
  assert.deepEqual(findTextMatches("text", "[", { useRegex: true }), {
    matches: [],
    invalidPattern: true
  });
  assert.deepEqual(findTextMatches("text", "^", { useRegex: true }), {
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
