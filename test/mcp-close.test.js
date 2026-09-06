// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { bootApp, settle } from "./helpers/app-harness.js";

test("closing drains an in-flight creation and rejects additional writes", async () => {
  let closeHandler;
  let destroyed = false;
  let release;
  let savedNotes = [];
  let hold = true;
  const app = await bootApp({
    handlers: {
      load_workspace_preference: () => "/tmp/close-mcp.db",
      load_db_notes: () => [{ id: "original", title: "Original", content: "", updatedAt: 1 }],
      start_mcp_server: () => ({ command: "/scratchpad", args: ["--mcp-stdio"] }),
      save_workspace_db: async ({ notes }) => {
        if (hold) await new Promise(resolve => { release = resolve; });
        savedNotes = structuredClone(notes);
      }
    },
    windowApi: { getCurrentWindow: () => ({
      onCloseRequested: async handler => { closeHandler = handler; },
      destroy: async () => { destroyed = true; }
    }) }
  });
  app.click("agent-access-toggle-btn");
  await settle();
  app.click("mcp-permission-create_note");
  await settle();
  app.click("mcp-permission-create_folder");
  await settle();
  const collectionId = app.invocations.findLast(i => i.command === "update_mcp_snapshot").args.collectionId;
  const send = (ticket, title) => app.emit("mcp-write-request", {
    ticket, operation: "create_note", arguments: { collectionId, requestId: ticket, title }
  });
  const first = send("first", "Keep on close");
  await settle(20);
  assert.equal(typeof release, "function");
  const closing = closeHandler({ preventDefault() {} });
  await send("late", "Too late");
  const late = app.invocations.findLast(i => i.command === "complete_mcp_write" && i.args.ticket === "late");
  assert.equal(late.args.result.ok, false);
  assert.equal(destroyed, false);
  hold = false;
  release();
  await Promise.all([first, closing]);
  assert.equal(destroyed, true);
  assert.ok(savedNotes.some(n => n.title === "Keep on close"));
  assert.ok(!savedNotes.some(n => n.title === "Too late"));
});
