// SPDX-License-Identifier: GPL-3.0-or-later

// Connecting and disconnecting a workspace, which is where the local-only notes
// were previously lost, plus the preview link handling the desktop webview does
// not provide on its own.

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

const LOCAL_NOTES = [
  { id: "local-1", title: "Local one", content: "local one body", updatedAt: 1, isTitleLocked: true },
  { id: "local-2", title: "Local two", content: "local two body", updatedAt: 2, isTitleLocked: true }
];

const WORKSPACE_NOTES = [
  { id: "ws-1", title: "Workspace note", content: "workspace body", updatedAt: 9, isTitleLocked: true }
];

let workspaceNotes = [];

const app = await bootApp({
  storage: { scratchpad_notes: LOCAL_NOTES },
  handlers: {
    select_db_file: () => "/tmp/scratchpad-test-workspace.db",
    load_db_notes: () => workspaceNotes,
    save_notes_db: ({ notes }) => {
      workspaceNotes = notes;
      return null;
    }
  }
});

test("the local notes load on start-up", () => {
  assert.deepEqual(app.sidebarTitles(), ["Local one", "Local two"]);
});

test("connecting a populated workspace preserves the local-only notes", async () => {
  workspaceNotes = WORKSPACE_NOTES;

  app.click("db-connect-btn");
  await app.settle();

  assert.deepEqual(app.sidebarTitles(), ["Workspace note"], "the workspace takes over the editor");
  assert.deepEqual(
    app.read("scratchpad_local_notes"),
    LOCAL_NOTES,
    "the local-only notes are set aside"
  );
});

test("editing while connected overwrites the local mirror", async () => {
  const editor = app.dom.window.document.getElementById("editor-textarea");
  editor.value = "edited inside the workspace";
  editor.dispatchEvent(new app.dom.window.Event("input"));
  await app.settle(600);

  assert.equal(
    app.read("scratchpad_notes")[0].id,
    "ws-1",
    "the mirror now holds the workspace, not the local notes"
  );
});

test("disconnecting hands the local-only notes back", async () => {
  app.click("db-disconnect-btn");
  await app.settle();

  assert.deepEqual(app.sidebarTitles(), ["Local one", "Local two"]);
  assert.deepEqual(app.read("scratchpad_notes"), LOCAL_NOTES);
  assert.equal(
    app.read("scratchpad_local_notes"),
    null,
    "the set-aside copy is consumed once restored"
  );
});

test("preview links are opened through the system browser", async () => {
  const preview = app.dom.window.document.getElementById("markdown-preview");
  preview.innerHTML =
    '<a href="https://example.com/docs" target="_blank" rel="noopener noreferrer">docs</a>' +
    '<a href="javascript:alert(1)">unsafe</a>' +
    '<a href="#a-heading">anchor</a>';

  const click = (selector) => {
    app.invocations.length = 0;
    preview.querySelector(selector).dispatchEvent(
      new app.dom.window.MouseEvent("click", { bubbles: true, cancelable: true })
    );
    return app.settle(20);
  };

  await click('a[href^="https"]');
  assert.deepEqual(app.invocations, [
    { command: "plugin:opener|open_url", args: { url: "https://example.com/docs" } }
  ]);

  await click('a[href^="javascript"]');
  assert.deepEqual(app.invocations, [], "an unsupported scheme never reaches the system");

  await click('a[href^="#"]');
  assert.deepEqual(app.invocations, [], "an in-document anchor never reaches the system");
});
