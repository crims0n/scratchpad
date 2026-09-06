// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { bootApp, settle } from "./helpers/app-harness.js";

test("configuration is usable while MCP is off and does not start the listener", async () => {
  const app = await bootApp({ handlers: {
    get_mcp_connection_info: () => ({ command: "/Applications/Scratchpad.app/Contents/MacOS/scratchpad", args: ["--mcp-stdio"] }),
    start_mcp_server: () => ({ command: "/Applications/Scratchpad.app/Contents/MacOS/scratchpad", args: ["--mcp-stdio"] })
  } });
  const button = document.getElementById("agent-access-config-btn");
  assert.notEqual(button.style.display, "none");
  app.click("agent-access-config-btn");
  await settle();
  assert.equal(document.getElementById("mcp-config-modal-backdrop").style.display, "flex");
  assert.equal(document.getElementById("mcp-config-args").value, "--mcp-stdio");
  assert.match(document.getElementById("mcp-config-command").value, /Scratchpad/);
  assert.ok([...document.querySelectorAll("[data-mcp-tool]")].every(input => input.disabled));
  assert.match(document.getElementById("mcp-permission-status").textContent, /Agent access is off/);
  const copied = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async value => { copied.push(value); } } });
  app.click("copy-mcp-example-btn");
  await settle();
  assert.deepEqual(JSON.parse(copied[0]).mcpServers.scratchpad.args, ["--mcp-stdio"]);
  assert.ok(!app.invocations.some(i => ["start_mcp_server", "set_mcp_permissions"].includes(i.command)));
  assert.equal(document.getElementById("mcp-status").hidden, true);
  app.click("close-mcp-config-btn");
  app.click("agent-access-toggle-btn");
  await settle();
  app.click("agent-access-toggle-btn");
  await settle();
  assert.notEqual(button.style.display, "none");
  app.click("agent-access-config-btn");
  await settle();
  assert.equal(document.getElementById("mcp-config-modal-backdrop").style.display, "flex");
  assert.equal(document.getElementById("mcp-status").hidden, true);
});
