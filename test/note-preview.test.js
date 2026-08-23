// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { getNotePreview } from "../src/note-preview.js";

test("uses the first content line when a custom title is different", () => {
  const preview = getNotePreview({
    title: "Project notes",
    content: "First useful detail\nAnother detail",
    isTitleLocked: true
  });

  assert.equal(preview, "First useful detail");
});

test("skips the line used to generate an automatic title", () => {
  const preview = getNotePreview({
    title: "A generated title",
    content: "# A generated title\n\nThe first distinct line of content",
    isTitleLocked: false
  });

  assert.equal(preview, "The first distinct line of content");
});

test("recognizes an automatic title truncated from a long first line", () => {
  const preview = getNotePreview({
    title: "This automatic title is truncat",
    content: "This automatic title is truncated from a longer heading\nUseful details",
    isTitleLocked: false
  });

  assert.equal(preview, "Useful details");
});

test("does not repeat a title-only scratchpad", () => {
  const preview = getNotePreview({
    title: "Only a title",
    content: "# Only a title",
    isTitleLocked: false
  });

  assert.equal(preview, "No additional content...");
});

test("labels a blank scratchpad", () => {
  assert.equal(getNotePreview({ title: "Untitled", content: "" }), "Empty scratchpad...");
});
