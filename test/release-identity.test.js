// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readConfig = async name => JSON.parse(await readFile(new URL(`../src-tauri/${name}`, import.meta.url), "utf8"));

test("the renamed app keeps the published storage and MCP identity", async () => {
  const config = await readConfig("tauri.conf.json");
  const beta = await readConfig("tauri.beta.conf.json");
  assert.equal(config.productName, "Scratchpad");
  assert.equal(config.identifier, "io.github.crims0n.scratchpad.beta");
  assert.equal(beta.identifier, config.identifier);
  assert.equal(config.mainBinaryName, undefined); // Keep Cargo's existing scratchpad executable.
});

test("the renamed MSI retains the published Scratchpad Beta upgrade code", async () => {
  const config = await readConfig("tauri.conf.json");
  // Tauri 2.12.3's original default: UUIDv5(DNS, "Scratchpad Beta.exe.app.x64").
  // This installation identity must survive future product-name changes too.
  assert.equal(config.bundle.windows.wix.upgradeCode, "425f5eeb-5cef-5929-8fcc-d21bcbaf7de9");
});

test("the renamed Debian package replaces beta without making beta conflict with itself", async () => {
  const config = await readConfig("tauri.conf.json");
  const beta = await readConfig("tauri.beta.conf.json");
  assert.deepEqual(config.bundle.linux.deb.conflicts, ["scratchpad-beta"]);
  assert.deepEqual(config.bundle.linux.deb.replaces, ["scratchpad-beta"]);
  assert.deepEqual(beta.bundle.linux.deb.conflicts, []);
  assert.deepEqual(beta.bundle.linux.deb.replaces, []);
});
