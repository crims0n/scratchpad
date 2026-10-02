// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { marked } from "marked";
import { buildNoteHtml } from "../src/note-html-export.js";
import { getAppElement, bootApp } from "./helpers/app-harness.js";

const notes = [
  { id: "one", title: "Primary", content: "# Original", updatedAt: 1, isTitleLocked: true },
  { id: "two", title: "Secondary", content: "# Other", updatedAt: 2, isTitleLocked: true }
];
let outcome = "cancel";
let finish;
let fontsReady;
const jobs = [];
const app = await bootApp({ globals: { marked }, storage: { scratchpad_notes: notes },
  handlers: { open_note_print: snapshot => {
    const html = buildNoteHtml({ ...snapshot, markedApi: marked });
    const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
    const record = () => jobs.push({ title: snapshot.title, body });
    if (outcome === "preparing") return new Promise(resolve => { fontsReady = () => { record(); resolve(); }; });
    record();
    if (outcome === "error") throw new Error("print failed");
    if (outcome === "pending") return new Promise(resolve => { finish = resolve; });
    return null;
  }, select_db_file: () => "/tmp/print-workspace.sqlite", load_db_notes: () => [
    { id: "workspace", title: "Workspace note", content: "# Workspace", updatedAt: 1 }
  ] } });
const element = id => getAppElement(id);
const input = (id, value) => {
  element(id).value = value;
  element(id).dispatchEvent(new window.Event("input"));
};

test("Print Note captures immediate edits and excludes stale previews, search highlights, and app chrome", async () => {
  element("markdown-preview").innerHTML = '<mark class="find-preview-match">STALE</mark>';
  input("editor", "# Latest\n\n**fresh**<script>alert(1)</script>");
  const before = app.dumpStorage();
  element("save-status").textContent = "Unsaved sentinel";
  app.click("print-note-btn");
  await app.settle();
  assert.equal(jobs.at(-1).title, "Primary");
  assert.match(jobs.at(-1).body, /<h1>Latest<\/h1>/);
  assert.match(jobs.at(-1).body, /<strong>fresh<\/strong>/);
  assert.doesNotMatch(jobs.at(-1).body, /STALE|<mark\b|<script\b|sidebar|textarea/);
  assert.deepEqual(app.dumpStorage(), before);
  assert.equal(element("save-status").textContent, "Unsaved sentinel", "cancellation has no misleading print/save success message");
  assert.equal(document.querySelectorAll("iframe[data-note-print]").length, 0);
});

test("print selection follows the active split pane and title focus, just like HTML export", async () => {
  app.click("split-note-btn");
  element("secondary-note-title").focus();
  input("secondary-editor", "# Secondary latest");
  app.click("print-note-btn");
  await app.settle();
  assert.equal(jobs.at(-1).title, "Secondary");
  assert.match(jobs.at(-1).body, /Secondary latest/);
  element("note-title").focus();
  app.click("print-note-btn");
  await app.settle();
  assert.equal(jobs.at(-1).title, "Primary");
  app.click("split-note-btn");
});

test("Cmd/Ctrl+P prints notes, but is suppressed behind an app modal", async () => {
  for (const modifier of ["metaKey", "ctrlKey"]) {
    const count = jobs.length;
    const event = new window.KeyboardEvent("keydown", { key: "p", [modifier]: true, bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    await app.settle();
    assert.equal(jobs.length, count + 1);
  }
  app.click("help-btn");
  const count = jobs.length;
  const event = new window.KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  await app.settle();
  assert.equal(event.defaultPrevented, true);
  assert.equal(jobs.length, count);
  app.click("close-help-btn");
});

test("printing is single-flight, snapshots do not change during preparation, and errors allow retry", async () => {
  outcome = "preparing";
  const count = jobs.length;
  app.click("print-note-btn");
  app.click("print-note-btn");
  assert.equal(element("print-note-btn").disabled, true);
  input("editor", "# Later edit");
  fontsReady();
  await app.settle();
  assert.equal(jobs.length, count + 1);
  assert.match(jobs.at(-1).body, /Latest/);
  assert.doesNotMatch(jobs.at(-1).body, /Later edit/);
  assert.equal(element("print-note-btn").disabled, false);
  outcome = "pending";
  app.click("print-note-btn");
  await app.settle();
  app.click("print-note-btn");
  assert.equal(jobs.length, count + 2);
  finish();
  await app.settle();
  outcome = "error";
  app.click("print-note-btn");
  await app.settle();
  assert.match(element("save-status").textContent, /Could not print note: Error: print failed/);
  assert.equal(element("print-note-btn").disabled, false);
  assert.equal(document.querySelectorAll("iframe[data-note-print]").length, 0);
  outcome = "cancel";
});

test("workspace printing leaves the separate local collection untouched", async () => {
  await app.settle(700);
  const before = app.read("scratchpad_notes");
  app.click("db-connect-btn");
  await app.settle();
  app.invocations.length = 0;
  app.click("print-note-btn");
  await app.settle();
  assert.equal(jobs.at(-1).title, "Workspace note");
  assert.match(jobs.at(-1).body, /<h1>Workspace<\/h1>/);
  assert.deepEqual(app.read("scratchpad_notes"), before);
  assert.deepEqual(app.invocations.map(item => item.command), ["open_note_print"], "printing never sends a storage write");
});

test("a failed native preview request reports an error and allows retry", async () => {
  const count = jobs.length;
  outcome = "error";
  app.click("print-note-btn");
  await app.settle();
  assert.equal(jobs.length, count + 1);
  assert.match(element("save-status").textContent, /print failed/);
  assert.equal(element("print-note-btn").disabled, false);
  outcome = "cancel";
});

test("browser-only printing uses a sanitized temporary note document instead of a native command", async () => {
  const bridge = window.__TAURI__;
  window.__TAURI__ = undefined;
  const append = document.body.appendChild.bind(document.body);
  let printed = false;
  document.body.appendChild = node => {
    const result = append(node);
    if (node.tagName === "IFRAME") {
      node.contentWindow.focus = () => {};
      node.contentWindow.print = () => {
        printed = true;
        assert.equal(node.contentDocument.title, "Workspace note");
        assert.equal(node.contentDocument.querySelector("h1").textContent, "Workspace");
        assert.equal(node.contentDocument.querySelectorAll("button, textarea, script").length, 0);
      };
    }
    return result;
  };
  try {
    app.invocations.length = 0;
    app.click("print-note-btn");
    await app.settle();
    assert.equal(printed, true);
    assert.deepEqual(app.invocations, []);
    assert.equal(document.querySelectorAll("iframe[data-note-print]").length, 0);
  } finally {
    window.__TAURI__ = bridge;
    document.body.appendChild = append;
  }
});
