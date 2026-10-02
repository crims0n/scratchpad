// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import { marked } from "marked";

const html = await readFile(new URL("../src/note-print.html", import.meta.url), "utf8");
let instance = 0;
async function boot({ snapshot = { title: "Printed <title>", content: "# Note\n\n**bold**", syntaxHighlighting: true },
  loadError = null, onPrint = () => {} } = {}) {
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;
  window.marked = marked;
  const calls = [];
  window.__TAURI__ = { core: { invoke: async command => {
    calls.push(command);
    if (command === "get_print_note") { if (loadError) throw loadError; return snapshot; }
    if (command === "print_note_native") return onPrint(document);
  } }, window: { getCurrentWindow: () => ({ close: async () => { calls.push("close"); } }) } };
  await import(`${new URL("../src/note-print-window.js", import.meta.url).href}?test=${++instance}`);
  return { dom, calls };
}

test("native preview sanitizes Markdown, auto-prints a ready note and retains it until closed", async () => {
  const app = await boot({ snapshot: { title: '</title><script>unsafe</script>',
    content: '# Note\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\n![tracker](https://example.com/image)',
    syntaxHighlighting: false }, onPrint: doc => {
    assert.equal(doc.querySelector("article h1").textContent, "Note");
    assert.equal(doc.querySelectorAll("article script, article img, article a[href]").length, 0);
    assert.equal(doc.title, '</title><script>unsafe</script>');
  } });
  assert.deepEqual(app.calls, ["get_print_note", "print_note_native"]);
  assert.ok(document.querySelector("article"), "native cancellation does not destroy an asynchronous print operation's document");
  assert.equal(document.getElementById("print-btn").disabled, false);
  assert.equal(document.getElementById("print-status").textContent, "Close this window when finished.");
  document.getElementById("close-btn").click();
  await Promise.resolve();
  assert.equal(app.calls.at(-1), "close");
});

test("native print failure reports no success and the preview supports retry", async () => {
  let error = true;
  const app = await boot({ onPrint: () => { if (error) throw new Error("printer unavailable"); } });
  assert.match(document.getElementById("print-status").textContent, /Could not print note.*printer unavailable/);
  assert.equal(document.getElementById("print-btn").disabled, false);
  error = false;
  document.getElementById("print-btn").click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(app.calls.filter(command => command === "print_note_native").length, 2);
  assert.equal(document.getElementById("print-status").textContent, "Close this window when finished.");
});

test("native print is single-flight and its shortcut cannot bypass the guard", async () => {
  let manual = false;
  let finish;
  const app = await boot({ onPrint: () => manual ? new Promise(resolve => { finish = resolve; }) : undefined });
  manual = true;
  const event = new window.KeyboardEvent("keydown", { key: "p", metaKey: true, cancelable: true, bubbles: true });
  document.dispatchEvent(event);
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "p", ctrlKey: true, cancelable: true }));
  document.getElementById("print-btn").click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(event.defaultPrevented, true);
  assert.equal(app.calls.filter(command => command === "print_note_native").length, 2, "one initial auto print and one manual print");
  finish();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(document.getElementById("print-btn").disabled, false);
});

test("failed snapshot preparation never invokes printing, and Close remains usable", async () => {
  const app = await boot({ loadError: new Error("no snapshot") });
  assert.deepEqual(app.calls, ["get_print_note"]);
  assert.match(document.getElementById("print-status").textContent, /Could not prepare note.*no snapshot/);
  assert.equal(document.getElementById("print-btn").disabled, true);
  assert.equal(document.getElementById("close-btn").disabled, false);
});

test("native toolbar is excluded from print media and note links cannot navigate the preview", async () => {
  await boot({ snapshot: { title: "Links", content: "[link](https://example.com)", syntaxHighlighting: false } });
  const link = document.querySelector("article a");
  const click = new window.MouseEvent("click", { bubbles: true, cancelable: true });
  link.dispatchEvent(click);
  assert.equal(click.defaultPrevented, true);
  const styles = await readFile(new URL("../src/note-print-window.css", import.meta.url), "utf8");
  assert.match(styles, /@media print\s*\{\s*\.print-toolbar\s*\{\s*display: none !important/);
});
