// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp, settle } from "./helpers/app-harness.js";

test("MCP status follows confirmed access and workspace changes preserve the live collection", async () => {
  let startFails = true;
  let stopFails = true;
  let finishStarting;
  const app = await bootApp({
    storage: {
      scratchpad_notes: [{
        id: "local", title: "Local note", content: "Local body",
        updatedAt: 1, isTitleLocked: true
      }]
    },
    handlers: {
      start_mcp_server: () => {
        if (startFails) throw new Error("Port is already in use");
        return new Promise(resolve => { finishStarting = resolve; });
      },
      stop_mcp_server: () => {
        if (stopFails) throw new Error("Could not stop server");
      },
      select_db_file: () => "/tmp/mcp-workspace.db",
      load_db_notes: () => [{
        id: "workspace", title: "Workspace note", content: "Workspace body",
        updatedAt: 2, isTitleLocked: true
      }]
    }
  });
  const status = document.getElementById("mcp-status");
  const saveStatus = document.getElementById("save-status");
  const toggle = document.getElementById("agent-access-toggle-btn");
  assert.equal(status.hidden, true);

  toggle.click();
  await settle();
  assert.equal(status.hidden, true, "failed startup must not claim to be listening");
  assert.equal(toggle.disabled, false, "startup can be retried");

  startFails = false;
  toggle.click();
  await settle();
  assert.equal(status.hidden, true, "wait for the native listener to start");
  assert.equal(toggle.disabled, true);
  finishStarting({ command: "/Applications/Scratchpad.app/Contents/MacOS/scratchpad", args: ["--mcp-stdio"] });
  await settle();
  assert.equal(status.hidden, false);
  assert.equal(saveStatus.textContent, "Read-only agent access enabled");
  await settle(2100); // The existing status notification restores the save label.
  assert.equal(saveStatus.textContent, "Saved");

  toggle.click();
  await settle();
  assert.equal(status.hidden, false, "failed shutdown must retain the listening status");
  assert.equal(toggle.disabled, false);

  app.click("db-connect-btn");
  await settle(100);
  let snapshot = app.invocations.findLast(({ command }) => command === "update_mcp_snapshot").args;
  assert.equal(snapshot.collectionName, "mcp-workspace.db");
  assert.deepEqual(snapshot.notes.map(note => note.id), ["workspace"]);
  assert.equal(status.hidden, false);
  await settle(2100);
  assert.equal(saveStatus.textContent, "Saved (mcp-workspace.db)");

  app.click("db-disconnect-btn");
  await settle(100);
  snapshot = app.invocations.findLast(({ command }) => command === "update_mcp_snapshot").args;
  assert.equal(snapshot.collectionName, "Local notes");
  assert.deepEqual(snapshot.notes.map(note => note.id), ["local"]);
  assert.equal(status.hidden, false);
  await settle(2100);
  assert.equal(saveStatus.textContent, "Saved");

  stopFails = false;
  toggle.click();
  await settle();
  assert.equal(status.hidden, true);
  const stoppedAt = app.invocations.length;
  await app.type("Edit after access is disabled");
  assert.equal(app.invocations.slice(stoppedAt).some(({ command }) => command.includes("mcp")), false);
});
