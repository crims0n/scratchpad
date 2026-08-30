// SPDX-License-Identifier: GPL-3.0-or-later

// Connecting and disconnecting a workspace. The property under test is that a
// workspace session leaves the local-only collection exactly where it was, so
// there is always something to come back to.

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
const workspaceWrites = [];

const app = await bootApp({
  storage: { scratchpad_notes: LOCAL_NOTES },
  handlers: {
    select_db_file: () => "/tmp/scratchpad-test-workspace.db",
    load_db_notes: () => workspaceNotes,
    save_note_db: ({ note }) => {
      workspaceWrites.push(note);
      return null;
    },
    save_notes_db: ({ notes }) => {
      workspaceNotes = notes;
      return null;
    }
  }
});

test("the local notes load on start-up", () => {
  assert.deepEqual(app.sidebarTitles(), ["Local one", "Local two"]);
  assert.equal(document.getElementById("workspace-menu-value").textContent, "Local notes");
});

test("connecting a populated workspace leaves the local collection alone", async () => {
  workspaceNotes = WORKSPACE_NOTES;

  app.click("db-connect-btn");
  await app.settle();

  assert.deepEqual(app.sidebarTitles(), ["Workspace note"], "the workspace takes over the editor");
  assert.equal(
    document.getElementById("workspace-menu-value").textContent,
    "scratchpad-test-workspace.db"
  );
  assert.equal(document.getElementById("db-disconnect-btn").textContent, "Return to local notes");
  assert.deepEqual(app.read("scratchpad_notes"), LOCAL_NOTES, "the local collection is untouched");
});

test("editing in a workspace writes to the workspace, never to local storage", async () => {
  await app.type("edited inside the workspace");

  assert.equal(workspaceWrites.at(-1).content, "edited inside the workspace", "the workspace was written");
  assert.deepEqual(
    app.read("scratchpad_notes"),
    LOCAL_NOTES,
    "the local collection still holds the local notes"
  );
});

test("disconnecting returns the local collection", async () => {
  app.click("db-disconnect-btn");
  await app.settle();

  assert.deepEqual(app.sidebarTitles(), ["Local one", "Local two"]);
  assert.equal(document.getElementById("workspace-menu-value").textContent, "Local notes");
  assert.deepEqual(app.read("scratchpad_notes"), LOCAL_NOTES);
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
