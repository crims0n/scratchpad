// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { bootApp, settle } from "./helpers/app-harness.js";

test("agent access shares the live collection and can be turned off", async () => {
  const app = await bootApp({
    storage: {
      scratchpad_notes: [{
        id: "live-note",
        title: "Live note",
        content: "Saved body",
        updatedAt: 1,
        isTitleLocked: true,
        isPinned: false,
        folderId: null
      }],
      scratchpad_folders: [{ id: "work", name: "Work" }]
    },
    handlers: {
      start_mcp_server: () => ({
        command: "/Applications/Scratchpad.app/Contents/MacOS/scratchpad",
        args: ["--mcp-stdio"],
        mode: "readOnly"
      })
    }
  });

  app.click("agent-access-toggle-btn");
  await settle(30);

  assert.equal(document.getElementById("agent-access-menu-value").textContent, "Read-only");
  assert.equal(document.getElementById("agent-access-toggle-btn").textContent, "Disable agent access");
  assert.equal(document.getElementById("agent-access-config-btn").style.display, "block");
  assert.deepEqual(
    app.invocations.slice(-3).map(({ command }) => command),
    ["update_mcp_snapshot", "start_mcp_server", "update_mcp_snapshot"]
  );
  assert.equal(app.invocations.at(-3).args.collectionName, "Local notes");
  assert.equal(app.invocations.at(-3).args.notes[0].content, "Saved body");

  const copiedValues = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (value) => {
        copiedValues.push(value);
      }
    }
  });
  app.click("agent-access-config-btn");
  const configBackdrop = document.getElementById("mcp-config-modal-backdrop");
  assert.equal(configBackdrop.style.display, "flex");
  assert.equal(configBackdrop.getAttribute("aria-hidden"), "false");
  const command = "/Applications/Scratchpad.app/Contents/MacOS/scratchpad";
  const example = { mcpServers: { scratchpad: { command, args: ["--mcp-stdio"] } } };
  assert.equal(document.getElementById("mcp-config-command").value, command);
  assert.equal(document.getElementById("mcp-config-args").value, "--mcp-stdio");
  assert.deepEqual(JSON.parse(document.getElementById("mcp-config-example-code").textContent), example);
  assert.match(configBackdrop.textContent, /No URL, headers, bearer token, or environment variables are needed/);

  app.click("copy-mcp-command-btn");
  app.click("copy-mcp-args-btn");
  app.click("copy-mcp-example-btn");
  await settle(10);
  assert.deepEqual(copiedValues.slice(0, 2), [command, "--mcp-stdio"]);
  assert.deepEqual(JSON.parse(copiedValues[2]), example);

  app.click("close-mcp-config-btn");
  assert.equal(configBackdrop.style.display, "none");
  assert.equal(configBackdrop.getAttribute("aria-hidden"), "true");
  assert.equal(document.getElementById("mcp-config-command").value, "");
  assert.equal(document.getElementById("mcp-config-args").value, "");
  assert.equal(document.getElementById("mcp-config-example-code").textContent, "");

  const editor = document.getElementById("editor-textarea");
  editor.value = "Unsaved agent-visible body";
  editor.dispatchEvent(new app.dom.window.Event("input"));
  await settle(100);

  const noteUpdate = app.invocations.findLast(({ command }) => command === "update_mcp_note");
  assert.equal(noteUpdate.args.note.content, "Unsaved agent-visible body");
  assert.equal(JSON.parse(app.storage.getItem("scratchpad_notes"))[0].content, "Saved body");

  app.click("agent-access-toggle-btn");
  await settle(30);
  assert.equal(app.invocations.at(-1).command, "stop_mcp_server");
  assert.equal(document.getElementById("agent-access-menu-value").textContent, "Off");
  assert.equal(document.getElementById("agent-access-config-btn").style.display, "none");
});
