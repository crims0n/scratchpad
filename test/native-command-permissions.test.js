// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../src-tauri/${path}`, import.meta.url), "utf8");
test("capabilities assign separate permission groups to local editor and print windows", async () => {
  const [main, print] = await Promise.all([
    read("capabilities/default.json").then(JSON.parse), read("capabilities/note-print.json").then(JSON.parse)
  ]);
  assert.deepEqual(main.windows, ["main"]);
  assert.deepEqual(print.windows, ["note-print"]);
  assert.ok(main.permissions.includes("editor-commands"));
  assert.deepEqual(print.permissions, ["note-print-commands"]);
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
