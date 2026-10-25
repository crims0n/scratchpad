// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

const notes = [{ id: "local", title: "Local note", content: "Keep this note", updatedAt: 1, isTitleLocked: true }];
let instance = 0;
const boot = (storage, handlers) => bootApp({ instance: ++instance, storage: { scratchpad_notes: notes, ...storage }, handlers });

test("a missing native workspace is reported as unavailable, without trying to open it", async () => {
  const app = await boot({}, { load_workspace_preference: () => {
    throw { kind: "workspace-unavailable", message: "file is missing" };
  } });
  assert.match(document.getElementById("save-status").textContent, /Workspace unavailable; using local notes/);
  assert.deepEqual(app.sidebarTitles(), ["Local note"]);
  assert.deepEqual(app.read("scratchpad_notes"), notes);
  assert.equal(app.invocations.some(call => call.command === "load_db_notes"), false);
});

test("an invalid legacy migration clears its browser hint and is not retried next launch", async () => {
  const app = await boot({ scratchpad_active_db: "relative.db" }, { load_workspace_preference: () => {
    throw { kind: "legacy-workspace-unavailable", message: "migration consumed" };
  } });
  assert.match(document.getElementById("save-status").textContent, /Workspace unavailable/);
  assert.equal(app.read("scratchpad_active_db"), null);
  const next = await boot(app.dumpStorage(), { load_workspace_preference: () => null });
  assert.equal(next.invocations.find(call => call.command === "load_workspace_preference").args.legacyPath, null);
  assert.deepEqual(next.sidebarTitles(), ["Local note"]);
  assert.doesNotMatch(document.getElementById("save-status").textContent, /unavailable|unreadable/);
});

test("a native settings failure retains the legacy hint for retry without opening it", async () => {
  const app = await boot({ scratchpad_active_db: "/tmp/old-workspace.sqlite" }, { load_workspace_preference: () => {
    throw { kind: "settings-unreadable", message: "could not persist migration" };
  } });
  assert.equal(app.dom.window.localStorage.getItem("scratchpad_active_db"), "/tmp/old-workspace.sqlite");
  assert.equal(app.invocations.some(call => call.command === "load_db_notes"), false);
  assert.match(document.getElementById("save-status").textContent, /Workspace settings unreadable/);
  assert.deepEqual(app.read("scratchpad_notes"), notes);
});
