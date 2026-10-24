// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const tauriDir = new URL("../src-tauri/", import.meta.url);
const signingConfigPath = "src-tauri/tauri.windows-signing.conf.json";

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

test("Windows signing command points at the signing script", async () => {
  const config = await readJson(new URL("tauri.windows-signing.conf.json", tauriDir));
  const { cmd, args } = config.bundle.windows.signCommand;
  assert.equal(cmd, "powershell");
  assert.equal(args.at(-1), "%1", "the file to sign must be the last argument");

  // Tauri runs the sign command from src-tauri/ and only absolutizes relative
  // arguments that exist there, which the NSIS uninstaller step relies on.
  const script = args[args.indexOf("-File") + 1];
  assert.ok(existsSync(fileURLToPath(new URL(script, tauriDir))), `${script} must exist relative to src-tauri/`);
});

test("signing is not part of the default or platform Tauri config", async () => {
  // tauri.windows.conf.json would be merged into every Windows build, so the
  // signing config must keep its opt-in name.
  assert.equal(existsSync(fileURLToPath(new URL("tauri.windows.conf.json", tauriDir))), false);
  const config = await readJson(new URL("tauri.conf.json", tauriDir));
  assert.equal(config.bundle.windows?.signCommand, undefined);
});

test("the Windows stable build uses the signing config and verifies it", async () => {
  const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  const windowsArgs = /- platform: windows-latest\r?\n\s+args: >-\r?\n((?:[ \t]+--.*\r?\n)+)/.exec(workflow);
  assert.ok(windowsArgs, "release.yml must have a windows-latest matrix entry");
  assert.match(windowsArgs[1], new RegExp(`--config ${signingConfigPath.replaceAll(".", "\\.")}`));
  assert.match(workflow, /scripts\/setup-windows-signing\.ps1/);
  assert.match(workflow, /scripts\/verify-windows-release\.ps1/);
  assert.match(workflow, /id-token: write/);
});
