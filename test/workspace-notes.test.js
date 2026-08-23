// SPDX-License-Identifier: GPL-3.0-or-later

// Boots the real frontend against index.html with a stubbed Tauri bridge. These
// cover the paths where a workspace swaps out the local mirror, which is where
// local-only notes were previously lost, and the preview link handling the
// desktop webview does not provide on its own.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true });

const invocations = [];
let workspaceNotes = [];

async function invoke(command, args) {
  invocations.push({ command, args });
  switch (command) {
    case "load_workspace_preference":
      return null;
    case "load_db_notes":
      return workspaceNotes;
    case "select_db_file":
      return "/tmp/scratchpad-test-workspace.db";
    case "save_notes_db":
      workspaceNotes = args.notes;
      return null;
    default:
      return null;
  }
}

dom.window.__TAURI__ = { core: { invoke }, window: {} };
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true
});

const LOCAL_NOTES = [
  { id: "local-1", title: "Local one", content: "local one body", updatedAt: 1, isTitleLocked: true },
  { id: "local-2", title: "Local two", content: "local two body", updatedAt: 2, isTitleLocked: true }
];

localStorage.setItem("scratchpad_notes", JSON.stringify(LOCAL_NOTES));

await import("../src/main.js");

const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
const sidebarTitles = () =>
  [...document.querySelectorAll(".note-item-title")].map((element) => element.textContent);

await settle();

test("the local notes load on start-up", () => {
  assert.deepEqual(sidebarTitles(), ["Local one", "Local two"]);
});

test("connecting a populated workspace preserves the local-only notes", async () => {
  workspaceNotes = [
    { id: "ws-1", title: "Workspace note", content: "workspace body", updatedAt: 9, isTitleLocked: true }
  ];

  document.getElementById("db-connect-btn").click();
  await settle();

  assert.deepEqual(sidebarTitles(), ["Workspace note"], "the workspace takes over the editor");
  assert.deepEqual(
    JSON.parse(localStorage.getItem("scratchpad_local_notes")),
    LOCAL_NOTES,
    "the local-only notes are set aside"
  );
});

test("editing while connected overwrites the local mirror", async () => {
  const editor = document.getElementById("editor-textarea");
  editor.value = "edited inside the workspace";
  editor.dispatchEvent(new dom.window.Event("input"));
  await settle(600);

  const mirrored = JSON.parse(localStorage.getItem("scratchpad_notes"));
  assert.equal(mirrored[0].id, "ws-1", "the mirror now holds the workspace, not the local notes");
});

test("disconnecting hands the local-only notes back", async () => {
  document.getElementById("db-disconnect-btn").click();
  await settle();

  assert.deepEqual(sidebarTitles(), ["Local one", "Local two"]);
  assert.deepEqual(JSON.parse(localStorage.getItem("scratchpad_notes")), LOCAL_NOTES);
  assert.equal(
    localStorage.getItem("scratchpad_local_notes"),
    null,
    "the set-aside copy is consumed once restored"
  );
});

test("preview links are opened through the system browser", async () => {
  const preview = document.getElementById("markdown-preview");
  preview.innerHTML =
    '<a href="https://example.com/docs" target="_blank" rel="noopener noreferrer">docs</a>' +
    '<a href="javascript:alert(1)">unsafe</a>';

  invocations.length = 0;
  preview.querySelector('a[href^="https"]').dispatchEvent(
    new dom.window.MouseEvent("click", { bubbles: true, cancelable: true })
  );
  await settle(20);

  assert.deepEqual(invocations, [
    { command: "plugin:opener|open_url", args: { url: "https://example.com/docs" } }
  ]);

  invocations.length = 0;
  preview.querySelector('a[href^="javascript"]').dispatchEvent(
    new dom.window.MouseEvent("click", { bubbles: true, cancelable: true })
  );
  await settle(20);

  assert.deepEqual(invocations, [], "an unsupported scheme never reaches the system");
});
