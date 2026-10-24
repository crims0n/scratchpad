// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const tauriDir = new URL("../src-tauri/", import.meta.url);
const signingConfigPath = "src-tauri/tauri.macos-signing.conf.json";

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

function macosArgs(workflow) {
  const match = /- platform: macos-latest\r?\n\s+args: >-\r?\n((?:[ \t]+--.*\r?\n)+)/.exec(workflow);
  assert.ok(match, "beta-release.yml must have a macos-latest matrix entry");
  return match[1].trim().split(/\s+/);
}

test("macOS signing uses a Developer ID identity with hardened runtime and no entitlements", async () => {
  const { macOS } = (await readJson(new URL("tauri.macos-signing.conf.json", tauriDir))).bundle;
  assert.match(macOS.signingIdentity, /^Developer ID Application: .+ \([A-Z0-9]{10}\)$/);
  assert.equal(macOS.hardenedRuntime, true);
  // Every entitlement weakens the hardened runtime; adding one needs review
  // here and in scripts/verify-macos-release.sh.
  assert.equal(macOS.entitlements, undefined);
});

test("signing is not part of the default or platform Tauri config", async () => {
  // tauri.macos.conf.json would be merged into every macOS build, so the
  // signing config must keep its opt-in name.
  assert.equal(existsSync(fileURLToPath(new URL("tauri.macos.conf.json", tauriDir))), false);
  const config = await readJson(new URL("tauri.conf.json", tauriDir));
  assert.equal(config.bundle.macOS?.signingIdentity, undefined);
});

test("the macOS beta build overrides the ad-hoc identity and notarizes", async () => {
  const workflow = await readFile(new URL("../.github/workflows/beta-release.yml", import.meta.url), "utf8");
  const args = macosArgs(workflow);
  const configs = args.flatMap((arg, index) => (arg === "--config" ? [args[index + 1]] : []));
  // Later configs win, so the signing config must come after the beta config
  // that sets the ad-hoc "-" identity.
  assert.equal(configs.at(-1), signingConfigPath);
  assert.ok(configs.indexOf("src-tauri/tauri.beta.conf.json") < configs.indexOf(signingConfigPath));

  assert.match(workflow, /scripts\/setup-macos-signing\.sh src-tauri\/tauri\.macos-signing\.conf\.json/);
  assert.match(workflow, /scripts\/finalize-macos-release\.sh/);
  for (const name of ["APPLE_API_ISSUER", "APPLE_API_KEY", "APPLE_API_KEY_PATH"]) {
    assert.match(workflow, new RegExp(`^\\s+${name}: `, "m"), `${name} must reach the build for notarization`);
  }
  assert.match(workflow, /if: always\(\) && matrix\.platform == 'macos-latest'\r?\n\s+run: \|\r?\n\s+security delete-keychain/);
});
