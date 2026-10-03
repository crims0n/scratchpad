// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { marked } from "marked";
import { getAppElement, bootApp } from "./helpers/app-harness.js";

const localNotes = [
  { id: "one", title: "Primary", content: "# Original", updatedAt: 1, isTitleLocked: true },
  { id: "two", title: "Secondary 日本語", content: "# Other", updatedAt: 2, isTitleLocked: true }
];
let outcome = "success";
let finish;
const app = await bootApp({ storage: { scratchpad_notes: localNotes }, globals: { marked }, handlers: {
  save_html_file_native: () => {
    if (outcome === "pending") return new Promise(resolve => { finish = resolve; });
    if (outcome !== "success") throw outcome;
    return "/tmp/note.html";
  },
  select_db_file: () => "/tmp/export-workspace.sqlite",
  load_db_notes: () => [{ id: "workspace", title: "Workspace", content: "# Workspace body", updatedAt: 1 }]
} });
const element = id => getAppElement(id);
const exports = () => app.invocations.filter(item => item.command === "save_html_file_native");
const parsed = () => new JSDOM(exports().at(-1).args.content).window.document;
const input = (id, value) => {
  element(id).value = value;
  element(id).dispatchEvent(new window.Event("input"));
};

test("export renders immediate edits rather than a stale or search-decorated preview", async () => {
  element("markdown-preview").innerHTML = '<p><mark class="find-preview-match">STALE</mark></p>';
  input("editor", "# Immediate edit\n\n**fresh**");
  const before = app.dumpStorage();
  app.click("export-html-btn");
  await app.settle();
  assert.equal(parsed().querySelector("h1").textContent, "Immediate edit");
  assert.equal(parsed().querySelector("strong").textContent, "fresh");
  assert.equal(parsed().querySelectorAll("mark").length, 0);
  assert.equal(exports().at(-1).args.dbPath, null);
  assert.equal(exports().at(-1).args.defaultName, "Primary.html");
  assert.deepEqual(app.dumpStorage(), before, "export itself does not persist or mutate the collection");
  assert.match(element("save-status").textContent, /HTML file saved successfully/);
});

test("dual-note export follows the active pane, including its latest edits", async () => {
  app.click("split-note-btn");
  element("secondary-editor").focus();
  input("secondary-editor", "# Secondary latest");
  app.click("export-html-btn");
  await app.settle();
  assert.equal(parsed().querySelector("h1").textContent, "Secondary latest");
  assert.equal(parsed().title, "Secondary 日本語");
  assert.equal(exports().at(-1).args.defaultName, "Secondary-日本語.html");
  element("note-title").focus();
  app.click("export-html-btn");
  await app.settle();
  assert.equal(parsed().querySelector("h1").textContent, "Immediate edit");
  element("secondary-note-title").focus();
  app.click("export-html-btn");
  await app.settle();
  assert.equal(parsed().querySelector("h1").textContent, "Secondary latest");
  app.click("split-note-btn");
});

test("cancellation is quiet, failures report no success, and repeated clicks do not open more pickers", async () => {
  element("save-status").textContent = "Unsaved sentinel";
  element("save-status").className = "unsaved";
  outcome = "Cancelled";
  app.click("export-html-btn");
  await app.settle();
  assert.equal(element("save-status").textContent, "Unsaved sentinel");
  assert.equal(element("save-status").className, "unsaved");
  outcome = "disk full";
  app.click("export-html-btn");
  await app.settle();
  assert.match(element("save-status").textContent, /HTML export failed: disk full/);
  assert.equal(element("export-html-btn").disabled, false);
  outcome = "pending";
  const count = exports().length;
  app.click("export-html-btn");
  app.click("export-html-btn");
  assert.equal(exports().length, count + 1);
  assert.equal(element("export-html-btn").disabled, true);
  finish("/tmp/note.html");
  await app.settle();
  assert.equal(element("export-html-btn").disabled, false);
  outcome = "success";
});

test("workspace export uses the open workspace's note, protects its path and leaves local data alone", async () => {
  await app.settle(700);
  const before = app.read("scratchpad_notes");
  app.click("db-connect-btn");
  await app.settle();
  app.click("export-html-btn");
  await app.settle();
  assert.equal(parsed().querySelector("h1").textContent, "Workspace body");
  assert.equal(exports().at(-1).args.dbPath, "/tmp/export-workspace.sqlite");
  app.click("export-btn");
  await app.settle();
  const markdown = app.invocations.findLast(item => item.command === "save_file_native");
  assert.equal(markdown.args.dbPath, "/tmp/export-workspace.sqlite");
  assert.equal(markdown.args.content, "# Workspace body");
  assert.deepEqual(app.read("scratchpad_notes"), before);
});

test("unavailable parser fails visibly rather than exporting an empty document", async () => {
  const count = exports().length;
  window.marked = null;
  app.click("export-html-btn");
  await app.settle();
  assert.equal(exports().length, count);
  assert.match(element("save-status").textContent, /HTML export failed: Error: Markdown parser is unavailable/);
  assert.equal(element("export-html-btn").disabled, false);
  window.marked = marked;
});
