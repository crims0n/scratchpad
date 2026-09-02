// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { renderEditorLineNumbers } from "../src/editor-line-numbers.js";
import { bootApp } from "./helpers/app-harness.js";

test("line number rows preserve source lines and escape their mirror text", () => {
  const html = renderEditorLineNumbers("first\n\n<b>third</b>\n");

  assert.equal((html.match(/editor-line-number-row/g) ?? []).length, 4);
  assert.match(html, /data-line-number="1">first/);
  assert.match(html, /data-line-number="2">&#8203;/);
  assert.match(html, /data-line-number="3">&lt;b&gt;third&lt;\/b&gt;/);
  assert.match(html, /data-line-number="4">&#8203;/);
  assert.doesNotMatch(html, /<b>third<\/b>/);
});

test("primary and secondary line-number gutters update and follow editor scrolling", async () => {
  const app = await bootApp({
    storage: {
      scratchpad_editor_line_numbers: "true",
      scratchpad_notes: [
        {
          id: "primary-note",
          title: "Primary",
          content: "one\ntwo",
          updatedAt: 2,
          isTitleLocked: true
        },
        {
          id: "secondary-note",
          title: "Secondary",
          content: "alpha\nbeta\ngamma",
          updatedAt: 1,
          isTitleLocked: true
        }
      ]
    }
  });

  const editor = document.getElementById("editor-textarea");
  const gutter = document.getElementById("editor-line-numbers");
  assert.equal(gutter.children.length, 2);

  editor.value += "\nthree";
  editor.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
  await app.settle(30);
  assert.equal(gutter.children.length, 3);
  assert.equal(
    document.getElementById("editor-wrapper").style.getPropertyValue("--editor-line-number-gutter"),
    "calc(1ch + 1.5em)"
  );

  editor.value = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join("\n");
  editor.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
  await app.settle(30);
  assert.equal(gutter.children.length, 10);
  assert.equal(
    document.getElementById("editor-wrapper").style.getPropertyValue("--editor-line-number-gutter"),
    "calc(2ch + 1.5em)"
  );

  editor.scrollTop = 48;
  editor.dispatchEvent(new app.dom.window.Event("scroll"));
  assert.equal(gutter.scrollTop, 48);

  document.getElementById("split-note-btn").click();
  const secondaryEditor = document.getElementById("secondary-editor-textarea");
  const secondaryGutter = document.getElementById("secondary-editor-line-numbers");
  assert.equal(secondaryGutter.children.length, 3);

  secondaryEditor.scrollTop = 32;
  secondaryEditor.dispatchEvent(new app.dom.window.Event("scroll"));
  assert.equal(secondaryGutter.scrollTop, 32);
});

test("line numbers are off by default and their hidden gutters stay empty", async () => {
  const app = await bootApp({
    instance: 2,
    storage: {
      scratchpad_notes: [{
        id: "default-note",
        title: "Default",
        content: "one\ntwo",
        updatedAt: 1,
        isTitleLocked: true
      }]
    }
  });

  assert.equal(document.documentElement.classList.contains("editor-line-numbers-enabled"), false);
  assert.equal(document.getElementById("line-numbers-toggle").textContent, "Off");
  assert.equal(document.getElementById("line-numbers-toggle").getAttribute("aria-pressed"), "false");
  const editor = document.getElementById("editor-textarea");
  const gutter = document.getElementById("editor-line-numbers");
  const secondaryGutter = document.getElementById("secondary-editor-line-numbers");
  assert.equal(gutter.childNodes.length, 0);
  assert.equal(secondaryGutter.childNodes.length, 0);

  editor.value = "one\ntwo\nthree";
  editor.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
  await app.settle(30);
  assert.equal(gutter.childNodes.length, 0);

  document.getElementById("line-numbers-toggle").click();
  assert.equal(gutter.children.length, 3);
  document.getElementById("line-numbers-toggle").click();
  assert.equal(gutter.childNodes.length, 0);
});
