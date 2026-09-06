// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { bootApp, settle } from "./helpers/app-harness.js";

const reads = ["list_folders", "list_notes", "search_notes", "get_note", "list_trash"];
const writes = ["create_note", "create_folder", "append_to_note", "rename_note", "move_note", "rename_folder", "delete_note", "delete_folder"];

test("MCP Configuration controls each function, group selection, failures, and fresh-session defaults", async () => {
  let fail = false;
  let deferred = null;
  const app = await bootApp({ handlers: {
    start_mcp_server: () => ({ command: "/scratchpad", args: ["--mcp-stdio"] }),
    set_mcp_permissions: async () => {
      if (fail) throw new Error("Permission update failed");
      if (deferred) await new Promise(resolve => { deferred.resolve = resolve; });
    }
  } });
  const checkbox = tool => document.getElementById(`mcp-permission-${tool}`);
  const selected = () => [...document.querySelectorAll("[data-mcp-tool]:checked")].map(input => input.dataset.mcpTool);
  const nativeSelection = () => app.invocations.findLast(i => i.command === "set_mcp_permissions").args.tools;
  const check = async id => { app.click(id); await settle(); };
  assert.deepEqual([...document.querySelectorAll("#agent-access-menu-section button")].map(button => button.id), ["agent-access-toggle-btn", "agent-access-config-btn"]);
  await check("agent-access-toggle-btn");
  await check("agent-access-config-btn");
  assert.deepEqual(selected(), reads);
  assert.equal(document.getElementById("mcp-select-all-read").checked, true);
  assert.equal(document.getElementById("mcp-select-all-write").checked, false);
  assert.equal(document.querySelectorAll(".mcp-permission-group").length, 2);
  assert.doesNotMatch(document.getElementById("mcp-config-modal").textContent, /Which fields should I use/);

  await check("mcp-permission-create_note");
  assert.equal(checkbox("create_note").checked, true);
  assert.equal(checkbox("create_folder").checked, false);
  assert.equal(document.getElementById("mcp-select-all-write").indeterminate, true);
  assert.deepEqual(nativeSelection(), [...reads, "create_note"]);
  const collectionId = app.invocations.findLast(i => i.command === "update_mcp_snapshot").args.collectionId;
  await app.emit("mcp-write-request", { ticket: "denied-folder", operation: "create_folder", arguments: { collectionId, requestId: "denied-folder", name: "Unavailable" } });
  assert.equal(app.invocations.findLast(i => i.command === "complete_mcp_write").args.result.ok, false);

  await check("mcp-select-all-write");
  assert.deepEqual(nativeSelection(), [...reads, ...writes]);
  assert.equal(document.getElementById("mcp-select-all-write").checked, true);
  assert.equal(document.getElementById("mcp-select-all-write").indeterminate, false);
  await check("mcp-permission-create_folder");
  assert.equal(document.getElementById("mcp-select-all-write").indeterminate, true);
  await check("mcp-permission-get_note");
  assert.ok(!nativeSelection().includes("get_note"));
  assert.equal(document.getElementById("mcp-select-all-read").indeterminate, true);
  await check("mcp-select-all-read");
  assert.ok(reads.every(tool => nativeSelection().includes(tool)));
  await check("mcp-select-all-read");
  assert.ok(reads.every(tool => !nativeSelection().includes(tool)));

  const beforeFailure = selected();
  fail = true;
  await check("mcp-permission-create_folder");
  assert.deepEqual(selected(), beforeFailure);
  assert.match(document.getElementById("mcp-permission-status").textContent, /Could not save permissions/);
  fail = false;
  deferred = {};
  app.click("mcp-permission-create_folder");
  await settle(20);
  assert.equal(checkbox("create_folder").checked, false, "grant waits for native confirmation");
  assert.equal(checkbox("create_note").disabled, true);
  assert.equal(document.getElementById("agent-access-toggle-btn").disabled, true);
  const resolve = deferred.resolve;
  deferred = null;
  resolve();
  await settle();
  assert.equal(checkbox("create_folder").checked, true);

  const beforeClose = selected();
  app.click("close-mcp-config-btn");
  await check("agent-access-config-btn");
  assert.deepEqual(selected(), beforeClose, "closing configuration preserves this session's choices");
  app.click("close-mcp-config-btn");
  await check("agent-access-toggle-btn");
  await check("agent-access-toggle-btn");
  await check("agent-access-config-btn");
  assert.deepEqual(selected(), reads, "reenabling access resets to read-only defaults");
});
