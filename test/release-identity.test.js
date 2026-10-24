// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readConfig = async name => JSON.parse(await readFile(new URL(`../src-tauri/${name}`, import.meta.url), "utf8"));

test("the release override keeps the published storage, executable and MCP identity", async () => {
  const config = await readConfig("tauri.release.conf.json");
  const beta = await readConfig("tauri.beta.conf.json");
  assert.equal(config.productName, "Scratchpad");
  assert.equal(config.identifier, "io.github.crims0n.scratchpad.beta");
  assert.equal(beta.identifier, config.identifier);
  assert.equal(config.mainBinaryName, "scratchpad");
});

test("plain dev and local build commands cannot use release storage or MSI identity", async () => {
  const config = await readConfig("tauri.conf.json");
  const release = await readConfig("tauri.release.conf.json");
  assert.equal(config.identifier, "io.github.crims0n.scratchpad.dev");
  assert.notEqual(config.productName, release.productName);
  assert.notEqual(config.mainBinaryName, release.mainBinaryName);
  assert.equal(config.bundle.windows?.wix?.upgradeCode, undefined);
  assert.equal(config.bundle.windows?.nsis?.installerHooks, undefined);
  assert.equal(config.bundle.linux?.deb?.conflicts, undefined);
  assert.equal(config.bundle.linux?.deb?.replaces, undefined);
});

test("the renamed MSI retains the published Scratchpad Beta upgrade code", async () => {
  const config = await readConfig("tauri.release.conf.json");
  // Tauri 2.12.3's original default: UUIDv5(DNS, "Scratchpad Beta.exe.app.x64").
  // This installation identity must survive future product-name changes too.
  assert.equal(config.bundle.windows.wix.upgradeCode, "425f5eeb-5cef-5929-8fcc-d21bcbaf7de9");
});

test("the renamed Debian package replaces beta without making beta conflict with itself", async () => {
  const config = await readConfig("tauri.release.conf.json");
  const beta = await readConfig("tauri.beta.conf.json");
  assert.deepEqual(config.bundle.linux.deb.conflicts, ["scratchpad-beta"]);
  assert.deepEqual(config.bundle.linux.deb.replaces, ["scratchpad-beta"]);
  assert.deepEqual(beta.bundle.linux.deb.conflicts, []);
  assert.deepEqual(beta.bundle.linux.deb.replaces, []);
});

test("every release build explicitly selects the release identity before beta and signing overrides", async () => {
  const workflow = await readFile(new URL("../.github/workflows/beta-release.yml", import.meta.url), "utf8");
  const entries = [...workflow.matchAll(/- platform: (\S+)\r?\n\s+args: >-\r?\n((?:[ \t]+--.*\r?\n)+)/g)];
  assert.equal(entries.length, 3);
  for (const [, platform, args] of entries) {
    const configs = [...args.matchAll(/--config (\S+)/g)].map(match => match[1]);
    assert.equal(configs[0], "src-tauri/tauri.release.conf.json", platform);
    assert.equal(configs[1], "src-tauri/tauri.beta.conf.json", platform);
  }
});

test("only renamed release installers run the Beta transition", async () => {
  const release = await readConfig("tauri.release.conf.json");
  const beta = await readConfig("tauri.beta.conf.json");
  assert.equal(release.bundle.windows.nsis.installMode, "currentUser");
  const hook = await readFile(new URL(`../src-tauri/${release.bundle.windows.nsis.installerHooks}`, import.meta.url), "utf8");
  assert.match(hook, /!macro NSIS_HOOK_PREINSTALL/);
  assert.equal(beta.bundle.windows.nsis.installerHooks, null);
});
