// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { bootApp, getAppElement } from "./helpers/app-harness.js";

const source = '{\n  "items": [\n    "hidden needle",\n    "second"\n  ]\n}';
const notes = [
  { id: "one", title: "One", content: source, updatedAt: 2, isTitleLocked: true },
  { id: "two", title: "Two", content: source, updatedAt: 1, isTitleLocked: true }
];

test("fold controls hide source without changing saves, copying, or text undo; Find reveals nested matches", async () => {
  const app = await bootApp({ storage: { scratchpad_notes: notes } });
  const editor = getAppElement("editor");
  editor.applyEdit({ value: source.replace("second", "edited"), selectionStart: 0, selectionEnd: 0 });
  await app.settle(40);
  const edited = editor.value;
  let inputs = 0;
  editor.addEventListener("input", () => inputs += 1);
  const gutter = document.querySelector("#editor .cm-foldGutter .cm-gutterElement [data-expanded=true]");
  assert.ok(gutter, "folding works with line numbers off");
  gutter.click();
  assert.equal(editor.foldedRanges.length, 1);
  assert.equal(editor.value, edited);
  assert.equal(inputs, 0);
  assert.ok(!editor.contentDOM.textContent.includes("hidden needle"));
  const placeholder = editor.contentDOM.querySelector(".cm-foldPlaceholder");
  assert.equal(placeholder.tagName, "BUTTON");
  assert.match(placeholder.getAttribute("aria-label"), /Expand .* hidden lines/);
  placeholder.click();
  assert.equal(editor.foldedRanges.length, 0);
  assert.ok(editor.contentDOM.textContent.includes("hidden needle"));
  editor.toggleFold(2); editor.toggleFold(1);
  let copied;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => { copied = text; } } });
  editor.select();
  editor.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  app.click("ctx-copy"); await app.settle();
  assert.equal(copied, edited, "Select All copies complete folded source");
  assert.equal(editor.foldedRanges.length, 2);
  await app.settle(600);
  assert.equal(app.read("scratchpad_notes").find(note => note.id === "one").content, edited);
  editor.dispatchEvent(new window.KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true }));
  const input = getAppElement("find-input");
  input.value = "needle";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(editor.foldedRanges.length, 0, "selected Find match reveals every containing fold");
  assert.equal(editor.value.slice(editor.selectionStart, editor.selectionEnd), "needle");
  assert.ok(editor.contentDOM.querySelector("mark.active-match"));
  editor.toggleFold(1);
  assert.equal(editor.undo(), true);
  assert.equal(editor.value, source, "Undo skips presentation transactions");
  assert.equal(editor.redo(), true);
  assert.equal(editor.value, edited);
});

test("folds belong to the collection, note, and pane; Compare expands both panes", async () => {
  const app = await bootApp({ instance: 2, storage: { scratchpad_notes: notes }, handlers: {
    select_db_file: () => "/tmp/folding.sqlite", load_db_notes: () => notes
  } });
  const primary = getAppElement("editor"), secondary = getAppElement("secondary-editor");
  primary.toggleFold(1);
  document.querySelector('.note-item[data-id="two"]').click();
  assert.equal(primary.foldedRanges.length, 0, "equal text in another note does not inherit folds");
  primary.toggleFold(2);
  document.querySelector('.note-item[data-id="one"]').click();
  assert.deepEqual(primary.foldedRanges, [{ from: 1, to: source.length - 1 }]);
  app.click("split-note-btn");
  assert.equal(secondary.foldedRanges.length, 0, "the other pane starts independently");
  secondary.toggleFold(2);
  app.click("syntax-highlighting-toggle");
  app.click("line-numbers-toggle");
  assert.equal(primary.foldedRanges.length, 1);
  assert.equal(secondary.foldedRanges.length, 1);
  app.click("compare-notes-btn");
  assert.equal(primary.foldedRanges.length, 0);
  assert.equal(secondary.foldedRanges.length, 0);
  app.click("compare-notes-btn");
  primary.toggleFold(1);
  app.click("db-connect-btn"); await app.settle(100);
  assert.equal(primary.foldedRanges.length, 0, "workspace with the same note IDs has separate state");
  primary.toggleFold(2);
  app.click("db-disconnect-btn"); await app.settle(100);
  assert.deepEqual(primary.foldedRanges, [{ from: 1, to: source.length - 1 }], "returning to local restores its folds");
  app.click("db-connect-btn"); await app.settle(100);
  assert.equal(primary.foldedRanges.length, 1, "reopening the same workspace restores session folds");
  assert.equal(primary.view.state.doc.lineAt(primary.foldedRanges[0].from).number, 2);
});

test("edits map valid folds, refresh line counts, and remove unreliable boundaries immediately", async () => {
  await bootApp({ instance: 3, storage: { scratchpad_notes: notes } });
  const editor = getAppElement("editor");
  editor.toggleFold(2);
  const pos = editor.value.indexOf('"second"');
  editor.view.dispatch({ changes: { from: pos, insert: '"third",\n    ' } });
  assert.equal(editor.foldedRanges.length, 1);
  assert.match(editor.contentDOM.querySelector(".cm-foldPlaceholder").textContent, /4 lines/);
  const end = editor.value.indexOf("]");
  editor.view.dispatch({ changes: { from: end, to: end + 1 } });
  assert.equal(editor.foldedRanges.length, 0);
  editor.loadDocument("# First\nbody\n# Next\nend", { format: "MD", foldKey: "md" });
  editor.setPresentation({ format: "MD" });
  editor.toggleFold(1);
  editor.view.dispatch({ changes: { from: editor.value.indexOf("# Next"), to: editor.value.indexOf("# Next") + 2 } });
  assert.equal(editor.foldedRanges.length, 0, "changed section boundary expands the old heading fold");
  editor.loadDocument("<root>\n<child>\ntext\n</child>\n</root>", { format: "XML" });
  editor.toggleFold(1);
  const closeName = editor.value.indexOf("/child") + 1;
  editor.view.dispatch({ changes: { from: closeName, to: closeName + 5, insert: "other" } });
  assert.equal(editor.foldedRanges.length, 0, "mismatched XML tags invalidate ancestors");
});

test("stale cached source is discarded, editors stay read-only, and folds do not survive a new launch", async () => {
  const app = await bootApp({ instance: 4, storage: { scratchpad_notes: notes } });
  const editor = getAppElement("editor");
  editor.toggleFold(1);
  editor.loadDocument("plain", { foldKey: "other", format: "TXT" });
  editor.loadDocument(source.replace("second", "changed"), { foldKey: JSON.stringify([null, "one"]), format: "JSON" });
  assert.equal(editor.foldedRanges.length, 0);
  editor.readOnly = true;
  assert.equal(editor.toggleFold(1), true, "read-only source can still be folded");
  editor.applyEdit({ value: "blocked", selectionStart: 0, selectionEnd: 0 });
  assert.ok(editor.value.includes("changed"));
  const next = await bootApp({ instance: 5, storage: app.dumpStorage() });
  assert.equal(getAppElement("editor").foldedRanges.length, 0);
  assert.ok(!Object.keys(next.dumpStorage()).some(key => key.includes("fold")));
});
