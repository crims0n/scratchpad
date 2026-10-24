// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readConfig = async name => JSON.parse(await readFile(new URL(`../src-tauri/${name}`, import.meta.url), "utf8"));

test("the release override keeps the published storage, executable and MCP identity", async () => {
  const config = await readConfig("tauri.release.conf.json");
  assert.equal(config.productName, "Scratchpad");
  assert.equal(config.identifier, "io.github.crims0n.scratchpad.beta");
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

test("the renamed Debian package replaces the previously published beta", async () => {
  const config = await readConfig("tauri.release.conf.json");
  assert.deepEqual(config.bundle.linux.deb.conflicts, ["scratchpad-beta"]);
  assert.deepEqual(config.bundle.linux.deb.replaces, ["scratchpad-beta"]);
});

test("every stable build selects the production identity without a beta override", async () => {
  const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  const entries = [...workflow.matchAll(/- platform: (\S+)\r?\n\s+args: >-\r?\n((?:[ \t]+--.*\r?\n)+)/g)];
  assert.equal(entries.length, 3);
  for (const [, platform, args] of entries) {
    const configs = [...args.matchAll(/--config (\S+)/g)].map(match => match[1]);
    assert.equal(configs[0], "src-tauri/tauri.release.conf.json", platform);
    assert.equal(configs.some(path => path.includes("beta")), false, platform);
  }
  assert.equal(existsSync(new URL("../.github/workflows/beta-release.yml", import.meta.url)), false);
  assert.equal(existsSync(new URL("../src-tauri/tauri.beta.conf.json", import.meta.url)), false);
  assert.match(workflow, /scripts\/check-stable-release.mjs/);
  assert.match(workflow, /scripts\/prepare-stable-release.mjs/);
  assert.match(workflow, /scripts\/verify-release-draft.mjs/);
  assert.match(workflow, /needs: \[validate, prepare, build\]/);
});

test("one main-only draft preparation supplies every build and finalizer; draft access has push permission", async () => {
  const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  const prepare = workflow.split("  prepare:\n")[1].split("  build:\n")[0];
  const build = workflow.split("  build:\n")[1].split("  verify-draft:\n")[0];
  const verify = workflow.split("  verify-draft:\n")[1];
  for (const job of [prepare, verify]) {
    assert.match(job, /if: github.ref == 'refs\/heads\/main'/);
    assert.match(job, /contents: write/);
  }
  assert.equal((workflow.match(/node scripts\/prepare-stable-release.mjs/g) || []).length, 1);
  assert.match(build, /releaseId: \$\{\{ needs.prepare.outputs.release_id \}\}/);
  assert.equal((build.match(/RELEASE_ID: \$\{\{ needs.prepare.outputs.release_id \}\}/g) || []).length, 2);
  assert.match(verify, /RELEASE_ID: \$\{\{ needs.prepare.outputs.release_id \}\}/);
  assert.match(verify, /--release-id "\$RELEASE_ID" --download/);
  assert.doesNotMatch(workflow, /steps\.tauri\.outputs\.releaseId|needs\.build\.outputs\.release_id|gh release download/);
  assert.doesNotMatch(build, /tagName:|releaseName:|releaseDraft:|releaseCommitish:|releaseBody:|generateReleaseNotes:/);
});

test("only renamed release installers run the Beta transition", async () => {
  const release = await readConfig("tauri.release.conf.json");
  assert.equal(release.bundle.windows.nsis.installMode, "currentUser");
  const hook = await readFile(new URL(`../src-tauri/${release.bundle.windows.nsis.installerHooks}`, import.meta.url), "utf8");
  assert.match(hook, /!macro NSIS_HOOK_PREINSTALL/);
});
