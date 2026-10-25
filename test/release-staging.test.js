// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stageReleaseAssets } from "../scripts/stage-release-assets.mjs";
import { platformAssetNames } from "../scripts/release-verification.mjs";

async function staging(t, platform) {
  const root = await mkdtemp(join(tmpdir(), "scratchpad-stage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const names = platformAssetNames("1.0.0", platform).filter(name => !name.startsWith("SHA256SUMS"));
  const artifactPaths = names.map(name => join(root, name));
  for (const file of artifactPaths) await writeFile(file, `signed bytes for ${basename(file)}`);
  return { platform, version: "1.0.0", artifactPaths, outputDir: join(root, "staged") };
}

test("staging preserves Windows and Linux package names and exact bytes", async t => {
  for (const platform of ["windows", "linux"]) {
    const input = await staging(t, platform);
    const files = await stageReleaseAssets({ ...input, artifactPaths: [...input.artifactPaths, "irrelevant.sig"] });
    assert.deepEqual(files.map(file => basename(file)), input.artifactPaths.map(file => basename(file)));
    for (let index = 0; index < files.length; index++) {
      assert.deepEqual(await readFile(files[index]), await readFile(input.artifactPaths[index]));
    }
    await assert.rejects(stageReleaseAssets(input), /EEXIST/);
  }
});

test("the pinned Tauri action's unversioned macOS archive is normalized from its reported app path", async t => {
  const input = await staging(t, "macos");
  const app = join(input.outputDir, "..", "Scratchpad.app");
  await mkdir(app);
  await writeFile(`${app}.tar.gz`, "notarized and stapled app archive");
  const files = await stageReleaseAssets({ ...input,
    artifactPaths: [input.artifactPaths[0], app, `${app}.tar.gz`] });
  assert.deepEqual(files.map(file => basename(file)), platformAssetNames("1.0.0", "macos"));
  assert.equal(await readFile(files[1], "utf8"), "notarized and stapled app archive");
});

test("missing, wrong-version, ambiguous and non-file artifacts fail before staging", async t => {
  const input = await staging(t, "windows");
  const other = join(input.outputDir, "..", "other");
  await mkdir(other);
  const duplicate = join(other, basename(input.artifactPaths[0]));
  await writeFile(duplicate, "other candidate");
  for (const artifactPaths of [null, "not an array", [null], input.artifactPaths.slice(1),
    [input.artifactPaths[0].replace("1.0.0", "1.0.1"), input.artifactPaths[1]], [...input.artifactPaths, duplicate]]) {
    await assert.rejects(stageReleaseAssets({ ...input, artifactPaths }));
  }
  await rm(input.artifactPaths[0]);
  await mkdir(input.artifactPaths[0]);
  await assert.rejects(stageReleaseAssets(input), /regular built artifact/);
  await assert.rejects(stat(input.outputDir), /ENOENT/);
});

test("staging rejects symbolic links to package files", { skip: process.platform === "win32" }, async t => {
  const input = await staging(t, "linux");
  await rm(input.artifactPaths[0]);
  await symlink(input.artifactPaths[1], input.artifactPaths[0]);
  await assert.rejects(stageReleaseAssets(input), /regular built artifact/);
});

test("local finalizers reject the obsolete no-upload flag", { skip: process.platform === "win32" }, () => {
  for (const [name, args] of [["finalize-macos-release", []], ["sign-linux-release", ["unused-public-key.asc"]]]) {
    const script = fileURLToPath(new URL(`../scripts/${name}.sh`, import.meta.url));
    const result = spawnSync("bash", [script, ...args, "--no-upload"], { encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unknown argument: --no-upload/);
  }
});
