// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { bootApp, getAppElement } from "./helpers/app-harness.js";

test("external append fallback resets history for mismatched source or note identity", async () => {
  await bootApp({ instance: "append-fallback" });
  const editor = getAppElement("editor");
  editor.loadDocument("first", { foldKey: "one" });
  editor.applyEdit({ value: "first edited", selectionStart: 0, selectionEnd: 0 });
  editor.updateFromAppend("first edited appended", { foldKey: "two" });
  assert.equal(editor.value, "first edited appended");
  assert.equal(editor.undo(), false, "equal prefixes do not carry history between notes");
  editor.applyEdit({ value: "another edit", selectionStart: 0, selectionEnd: 0 });
  editor.updateFromAppend("authoritative content", { foldKey: "two" });
  assert.equal(editor.value, "authoritative content");
  assert.equal(editor.undo(), false, "mismatched source takes the full-load fallback");
});

test("editor transactions preserve history through presentation changes and keep panes independent", async () => {
  const app = await bootApp({ storage: { scratchpad_notes: [
    { id: "one", title: "One", content: "alpha", updatedAt: 2, isTitleLocked: true },
    { id: "two", title: "Two", content: "beta", updatedAt: 1, isTitleLocked: true }
  ] } });
  app.click("split-note-btn");
  const primary = getAppElement("editor"), secondary = getAppElement("secondary-editor");
  assert.equal(document.querySelectorAll("textarea").length, 0);
  assert.equal(primary.contentDOM.getAttribute("aria-label"), "Scratchpad content");
  assert.equal(secondary.contentDOM.getAttribute("aria-multiline"), "true");
  let inputCount = 0;
  primary.addEventListener("input", () => inputCount += 1);
  primary.applyEdit({ value: "# <img onerror=alert(1)>😀", selectionStart: 2, selectionEnd: 7 });
  secondary.applyEdit({ value: "beta edited", selectionStart: 11, selectionEnd: 11 });
  await app.settle(30);
  assert.equal(inputCount, 1);
  assert.equal(primary.contentDOM.querySelector("img"), null, "source markup stays text");
  assert.ok(primary.contentDOM.querySelector(".syntax-heading"));
  primary.setSelectionRange(2, 7, "backward");
  app.click("syntax-highlighting-toggle");
  app.click("line-numbers-toggle");
  app.click("compare-notes-btn");
  assert.deepEqual([primary.selectionStart, primary.selectionEnd, primary.selectionDirection], [2, 7, "backward"]);
  assert.equal(primary.undo(), true);
  assert.equal(primary.value, "alpha");
  assert.equal(secondary.value, "beta edited");
  assert.equal(primary.redo(), true);
  assert.equal(primary.value, "# <img onerror=alert(1)>😀");
  primary.readOnly = true;
  assert.equal(primary.contentDOM.getAttribute("aria-readonly"), "true");
  primary.applyEdit({ value: "blocked", selectionStart: 0, selectionEnd: 0 });
  assert.equal(primary.undo(), false);
  assert.equal(primary.value, "# <img onerror=alert(1)>😀");
  primary.focus();
  assert.equal(document.activeElement, primary.contentDOM, "read-only notes remain focusable for copying");
  primary.readOnly = false;
  assert.equal(primary.undo(), true, "locking does not erase existing history");
  await app.settle(600);
  assert.equal(app.read("scratchpad_notes").find(note => note.id === "two").content, "beta edited");
});

test("switching notes and collections resets text undo even when IDs and source text match", async () => {
  const app = await bootApp({ instance: 2, storage: { scratchpad_notes: [
    { id: "shared", title: "Shared", content: "same", updatedAt: 2, isTitleLocked: true },
    { id: "other", title: "Other", content: "same edited", updatedAt: 1, isTitleLocked: true }
  ] }, handlers: {
    select_db_file: () => "/tmp/editor-history.sqlite",
    load_db_notes: () => [{ id: "shared", title: "Workspace", content: "same edited", updatedAt: 1 }]
  } });
  const editor = getAppElement("editor");
  editor.applyEdit({ value: "same edited", selectionStart: 11, selectionEnd: 11 });
  document.querySelector('.note-item[data-id="other"]').click();
  assert.equal(editor.value, "same edited");
  assert.equal(editor.undo(), false);
  document.querySelector('.note-item[data-id="shared"]').click();
  editor.applyEdit({ value: "same twice edited", selectionStart: 16, selectionEnd: 16 });
  app.click("db-connect-btn");
  await app.settle(100);
  assert.equal(editor.value, "same edited");
  assert.equal(editor.undo(), false);
  app.click("db-disconnect-btn");
  await app.settle(100);
  assert.equal(editor.value, "same twice edited");
  assert.equal(editor.undo(), false);
});

test("context Cut and Paste use undoable transactions and cannot cross a note switch", async () => {
  const app = await bootApp({ instance: 3, storage: { scratchpad_notes: [
    { id: "one", title: "One", content: "same text", updatedAt: 2, isTitleLocked: true },
    { id: "two", title: "Two", content: "same text", updatedAt: 1, isTitleLocked: true }
  ] } });
  const editor = getAppElement("editor");
  let copied, completePaste;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async value => { copied = value; }, readText: async () => "pasted"
  } });
  const openMenu = () => editor.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  editor.setSelectionRange(0, 4);
  openMenu(); app.click("ctx-cut"); await app.settle();
  assert.equal(copied, "same");
  assert.equal(editor.value, " text");
  assert.equal(editor.undo(), true);
  assert.equal(editor.value, "same text");
  editor.setSelectionRange(0, 4);
  openMenu(); app.click("ctx-paste"); await app.settle();
  assert.equal(editor.value, "pasted text");
  assert.equal(editor.undo(), true);
  assert.equal(editor.value, "same text");
  editor.setSelectionRange(0, 4);
  navigator.clipboard.readText = () => new Promise(resolve => { completePaste = resolve; });
  openMenu(); app.click("ctx-paste");
  document.querySelector('.note-item[data-id="two"]').click();
  completePaste("wrong note"); await app.settle();
  assert.equal(editor.value, "same text");
  assert.equal(editor.undo(), false);
  openMenu(); app.click("ctx-select-all");
  assert.deepEqual([editor.selectionStart, editor.selectionEnd], [0, 9]);
  assert.equal(document.activeElement, editor.contentDOM);
});
