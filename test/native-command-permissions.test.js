// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../src-tauri/${path}`, import.meta.url), "utf8");
const [lib, build, main, print] = await Promise.all([
  read("src/lib.rs"), read("build.rs"), read("capabilities/default.json").then(JSON.parse),
  read("capabilities/note-print.json").then(JSON.parse)
]);
const commands = lib.match(/generate_handler!\[([^\]]+)\]/)[1].split(",")
  .map(command => command.trim().split("::").at(-1)).filter(Boolean);
const permission = command => `allow-${command.replaceAll("_", "-")}`;

test("every registered app command has an explicit permission and an intended window", () => {
  const declared = [...build.matchAll(/"([a-z_]+)"/g)].map(match => match[1]);
  assert.deepEqual([...declared].sort(), [...commands].sort());
  const printCommands = ["get_print_note", "print_note_native", "close_note_print"];
  const mainCommands = commands.filter(command => !printCommands.includes(command));
  assert.deepEqual(main.windows, ["main"]);
  assert.deepEqual(print.windows, ["note-print"]);
  assert.deepEqual(main.permissions.filter(value => typeof value === "string" && value.startsWith("allow-")).sort(), mainCommands.map(permission).sort());
  assert.deepEqual([...print.permissions].sort(), printCommands.map(permission).sort());
  assert.equal(main.remote, undefined);
  assert.equal(print.remote, undefined);
});

test("CSP forbids embedded frames, forms, objects and base URL changes", async () => {
  const config = JSON.parse(await read("tauri.conf.json"));
  const directives = new Map(config.app.security.csp.split(";").map(value => value.trim().split(/\s+(.*)/s).slice(0, 2)));
  for (const directive of ["base-uri", "form-action", "object-src", "frame-src"]) {
    assert.equal(directives.get(directive), "'none'");
  }
  assert.equal(directives.get("connect-src"), "ipc: http://ipc.localhost");
  assert.equal(directives.get("img-src"), "'self' data:");
});
