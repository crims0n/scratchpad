// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { getAppElement, editorContent, bootApp } from "./helpers/app-harness.js";

test("both editors follow detected formats through edits, Find, Compare, toggles, and collection switching", async () => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(new URL("../src/vendor/highlight.min.js", import.meta.url), "utf8"), context);
  const fixtures = [
    ["JSON", '{"name":"Scratchpad", "count":42}', ".syntax-key"],
    ["XML", '<note enabled="true">Hello</note>', ".syntax-tag"],
    ["YAML", "name: Scratchpad\nenabled: true", ".syntax-key"],
    ["CSV", 'name,description\nAlice,"# heading, **literal**"', ".syntax-csv-1"],
    ["MD", "# Heading\n**strong**", ".syntax-heading"],
    ["TXT", "Meeting: Friday", null]
  ];
  const notes = fixtures.map(([format, content], index) => ({
    id: format, title: `${format} note`, content, updatedAt: 10 - index, isTitleLocked: true
  }));
  const app = await bootApp({
    storage: { scratchpad_notes: notes },
    beforeBoot: window => { window.hljs = context.hljs; },
    handlers: {
      select_db_file: () => "/tmp/highlighting.db",
      load_db_notes: () => [{ id: "JSON", title: "Same ID, plain content", content: "plain text", updatedAt: 1 }]
    }
  });
  const { document, Event, KeyboardEvent } = app.dom.window;
  const editor = getAppElement("editor");
  const backdrop = editorContent("editor");
  for (const [format, content, selector] of fixtures) {
    document.querySelector(`.note-item[data-id="${format}"]`).click();
    assert.equal(editor.value, content);
    assert.equal([...backdrop.querySelectorAll(".cm-line")].map(line => line.textContent).join("\n"), content);
    if (selector) assert.ok(backdrop.querySelector(selector), `${format} receives its syntax`);
    else assert.equal(backdrop.querySelector('[class^="syntax-"]'), null);
  }
  document.querySelector('.note-item[data-id="JSON"]').click();
  app.click("split-note-btn");
  const secondary = getAppElement("secondary-editor");
  const secondaryBackdrop = editorContent("secondary-editor");
  const secondarySelect = document.getElementById("secondary-note-select");
  for (const [format, content, selector] of fixtures.filter(([format]) => format !== "JSON")) {
    secondarySelect.value = format;
    secondarySelect.dispatchEvent(new Event("change", { bubbles: true }));
    assert.equal(secondary.value, content);
    assert.equal([...secondaryBackdrop.querySelectorAll(".cm-line")].map(line => line.textContent).join("\n"), content);
    if (selector) assert.ok(secondaryBackdrop.querySelector(selector));
    else assert.equal(secondaryBackdrop.querySelector('[class^="syntax-"]'), null);
  }
  secondary.value = '{"name":"Scratchpad", "count":43}';
  secondary.dispatchEvent(new Event("input", { bubbles: true }));
  await app.settle(500);
  assert.equal(secondaryBackdrop.querySelector(".syntax-number").textContent, "43");
  app.click("compare-notes-btn");
  await app.settle(100);
  assert.ok(backdrop.querySelector(".syntax-number .diff-text-removed, .diff-text-removed .syntax-number"));
  assert.ok(secondaryBackdrop.querySelector(".syntax-number .diff-text-added, .diff-text-added .syntax-number"));
  app.click("syntax-highlighting-toggle");
  assert.equal(backdrop.querySelector('[class^="syntax-"]'), null);
  assert.equal(secondaryBackdrop.querySelector('[class^="syntax-"]'), null);
  assert.ok(secondaryBackdrop.querySelector(".diff-text-added"));
  app.click("syntax-highlighting-toggle");
  assert.ok(secondaryBackdrop.querySelector(".syntax-key"));
  app.click("split-note-btn");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }));
  const find = document.getElementById("find-input");
  find.value = "Scratchpad";
  find.dispatchEvent(new Event("input", { bubbles: true }));
  const activeMatch = backdrop.querySelector("mark.active-match");
  assert.equal(activeMatch.textContent, "Scratchpad");
  assert.ok(activeMatch.closest(".syntax-string") || activeMatch.querySelector(".syntax-string"));
  const selection = [editor.selectionStart, editor.selectionEnd];
  app.click("syntax-highlighting-toggle");
  assert.equal(backdrop.querySelector("mark.active-match").textContent, "Scratchpad");
  assert.deepEqual([editor.selectionStart, editor.selectionEnd], selection);
  app.click("syntax-highlighting-toggle");
  await app.type('{"name":"Scratchpad",');
  assert.equal(backdrop.querySelector('[class^="syntax-"]'), null);
  assert.equal(document.querySelector('.note-item.active .note-format-badge').textContent, "TXT");
  await app.type('<note>Hello</note>');
  assert.ok(backdrop.querySelector(".syntax-tag"));
  await app.type('<note>Hello');
  assert.equal(backdrop.querySelector('[class^="syntax-"]'), null);
  await app.type('{"restored":42}');
  assert.ok(backdrop.querySelector(".syntax-number"));
  app.click("db-connect-btn");
  await app.settle();
  assert.equal(editor.value, "plain text");
  assert.equal(backdrop.querySelector('[class^="syntax-"]'), null);
  app.click("db-disconnect-btn");
  await app.settle();
  assert.equal(editor.value, '{"restored":42}');
  assert.ok(backdrop.querySelector(".syntax-number"));
  assert.ok(app.read("scratchpad_notes").every(note => !("format" in note)));
});
