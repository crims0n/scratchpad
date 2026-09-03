// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import * as Diff from "diff";

import { compareNoteText, emptyNoteComparison } from "../src/note-compare.js";

test("identical note contents have no comparison decorations", () => {
  assert.deepEqual(compareNoteText("same\ntext", "same\ntext", Diff), emptyNoteComparison());
});

test("inserted and removed lines are decorated on their respective sides", () => {
  const comparison = compareNoteText(
    "shared\nleft only\nend\n",
    "shared\nright one\nright two\nend\n",
    Diff
  );

  assert.equal(comparison.changedLineCount, 2);
  assert.deepEqual(comparison.leftChangedLines, [1]);
  assert.deepEqual(comparison.rightChangedLines, [1, 2]);
  assert.equal(comparison.leftDecorations[0].className, "diff-line-removed");
  assert.equal(comparison.rightDecorations[0].className, "diff-line-added");
});

test("replacement blocks receive word-level refinement", () => {
  const left = "The quick brown fox\n";
  const right = "The quick red fox\n";
  const comparison = compareNoteText(left, right, Diff);
  const leftDetail = comparison.leftDecorations.find(({ className }) => className === "diff-text-removed");
  const rightDetail = comparison.rightDecorations.find(({ className }) => className === "diff-text-added");

  assert.equal(left.slice(leftDetail.start, leftDetail.end), "brown");
  assert.equal(right.slice(rightDetail.start, rightDetail.end), "red");
  assert.deepEqual(comparison.leftChangedLines, [0]);
  assert.deepEqual(comparison.rightChangedLines, [0]);
});

test("related words receive contiguous substring refinement", () => {
  const left = "watermelon";
  const right = "watermelons";
  const comparison = compareNoteText(left, right, Diff);
  const leftDetails = comparison.leftDecorations.filter(({ className }) => className === "diff-text-removed");
  const rightDetails = comparison.rightDecorations.filter(({ className }) => className === "diff-text-added");

  assert.deepEqual(leftDetails, []);
  assert.equal(rightDetails.length, 1);
  assert.equal(right.slice(rightDetails[0].start, rightDetails[0].end), "s");
});

test("substring refinement does not preserve scattered internal characters", () => {
  const left = "- pickle";
  const right = "- apple";
  const comparison = compareNoteText(left, right, Diff);
  const leftDetails = comparison.leftDecorations.filter(({ className }) => className === "diff-text-removed");
  const rightDetails = comparison.rightDecorations.filter(({ className }) => className === "diff-text-added");

  assert.equal(leftDetails.length, 1);
  assert.equal(rightDetails.length, 1);
  assert.equal(left.slice(leftDetails[0].start, leftDetails[0].end), "pick");
  assert.equal(right.slice(rightDetails[0].start, rightDetails[0].end), "app");
});

test("substring refinement preserves UTF-16 source offsets", () => {
  const left = "watermelon 🍉";
  const right = "watermelon 🍉s";
  const comparison = compareNoteText(left, right, Diff);
  const detail = comparison.rightDecorations.find(({ className }) => className === "diff-text-added");

  assert.equal(right.slice(detail.start, detail.end), "s");
  assert.equal(detail.start, right.length - 1);
});

test("unrelated replacement words retain whole-word highlighting", () => {
  const left = "alpha cat omega";
  const right = "alpha dog omega";
  const comparison = compareNoteText(left, right, Diff);
  const leftDetail = comparison.leftDecorations.find(({ className }) => className === "diff-text-removed");
  const rightDetail = comparison.rightDecorations.find(({ className }) => className === "diff-text-added");

  assert.equal(left.slice(leftDetail.start, leftDetail.end), "cat");
  assert.equal(right.slice(rightDetail.start, rightDetail.end), "dog");
});

test("a coincidental one-character edge match does not fragment unrelated words", () => {
  const left = "Left";
  const right = "Right";
  const comparison = compareNoteText(left, right, Diff);
  const leftDetail = comparison.leftDecorations.find(({ className }) => className === "diff-text-removed");
  const rightDetail = comparison.rightDecorations.find(({ className }) => className === "diff-text-added");

  assert.equal(left.slice(leftDetail.start, leftDetail.end), "Left");
  assert.equal(right.slice(rightDetail.start, rightDetail.end), "Right");
});

test("separate edit blocks are counted as separate changes", () => {
  const comparison = compareNoteText(
    "first old\nshared\nlast old",
    "first new\nshared\nlast new",
    Diff
  );

  assert.equal(comparison.changedLineCount, 2);
  assert.deepEqual(comparison.leftChangedLines, [0, 2]);
  assert.deepEqual(comparison.rightChangedLines, [0, 2]);
});

test("changed line totals use the larger side of each replacement block", () => {
  const comparison = compareNoteText(
    "shared\nleft one\nleft two\nleft three\nend",
    "shared\nright one\nend",
    Diff
  );

  assert.equal(comparison.changedLineCount, 3);
  assert.deepEqual(comparison.leftChangedLines, [1, 2, 3]);
  assert.deepEqual(comparison.rightChangedLines, [1]);
});

test("an unavailable bounded diff degrades to whole-document highlighting", () => {
  const comparison = compareNoteText("left", "right", {
    diffLines: () => undefined,
    diffWordsWithSpace: Diff.diffWordsWithSpace
  });

  assert.equal(comparison.changedLineCount, 1);
  assert.deepEqual(comparison.leftChangedLines, [0]);
  assert.deepEqual(comparison.rightChangedLines, [0]);
  assert.deepEqual(comparison.leftDecorations, [{
    start: 0,
    end: 4,
    className: "diff-line-removed"
  }]);
});

test("comparison requires a compatible diff implementation", () => {
  assert.throws(() => compareNoteText("left", "right", null), /compatible diff implementation/);
});
