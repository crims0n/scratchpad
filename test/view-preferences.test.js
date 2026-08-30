// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeEditorLineNumbers,
  normalizeEditorLineSpacing,
  normalizeEditorZoom,
  normalizeNotePreviewLines,
  normalizeSyntaxHighlighting,
  stepEditorLineSpacing,
  stepEditorZoom,
  stepNotePreviewLines
} from "../src/view-preferences.js";

test("zoom levels are rounded, bounded, and reject invalid preferences", () => {
  assert.equal(normalizeEditorZoom("1.26"), 1.3);
  assert.equal(normalizeEditorZoom(0.1), 0.5);
  assert.equal(normalizeEditorZoom(9), 2);
  assert.equal(normalizeEditorZoom("invalid"), 1);
  assert.equal(stepEditorZoom(1.9, 1), 2);
});

test("editor line spacing is rounded and bounded", () => {
  assert.equal(normalizeEditorLineSpacing("1.84"), 1.8);
  assert.equal(normalizeEditorLineSpacing(1), 1.2);
  assert.equal(normalizeEditorLineSpacing(3), 2.4);
  assert.equal(stepEditorLineSpacing(1.6, -1), 1.5);
});

test("note preview context is limited to one through ten lines", () => {
  assert.equal(normalizeNotePreviewLines("3"), 3);
  assert.equal(normalizeNotePreviewLines(0), 1);
  assert.equal(normalizeNotePreviewLines(12), 10);
  assert.equal(normalizeNotePreviewLines("invalid"), 2);
  assert.equal(stepNotePreviewLines(9, 1), 10);
});

test("syntax highlighting preferences accept stored booleans and default on", () => {
  assert.equal(normalizeSyntaxHighlighting("true"), true);
  assert.equal(normalizeSyntaxHighlighting("1"), true);
  assert.equal(normalizeSyntaxHighlighting("false"), false);
  assert.equal(normalizeSyntaxHighlighting("0"), false);
  assert.equal(normalizeSyntaxHighlighting(null), true);
});

test("editor line number preferences accept stored booleans and default off", () => {
  assert.equal(normalizeEditorLineNumbers("true"), true);
  assert.equal(normalizeEditorLineNumbers("1"), true);
  assert.equal(normalizeEditorLineNumbers("false"), false);
  assert.equal(normalizeEditorLineNumbers("0"), false);
  assert.equal(normalizeEditorLineNumbers(null), false);
});
