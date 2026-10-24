// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stableRelease, assertReleaseAvailable } from "../scripts/check-stable-release.mjs";
import { expectedAssets, verifyDraft } from "../scripts/verify-release-draft.mjs";

test("only canonical stable versions starting at 1.0.0 can create releases", () => {
  assert.deepEqual(stableRelease("1.0.0"), { version: "1.0.0", tag: "v1.0.0" });
  assert.equal(stableRelease("2.10.3").tag, "v2.10.3");
  for (const invalid of ["0.8.2", "1.0.0-beta.1", "1.0.0+build", "v1.0.0", " 1.0.0 ", "1.0", "01.0.0", "garbage", undefined]) {
    assert.throws(() => stableRelease(invalid), /Stable releases require/);
  }
});

test("existing tags and draft releases block reuse; malformed responses fail closed", () => {
  assertReleaseAvailable("v1.0.0", [{ ref: "refs/tags/v1.0.0-rc.1" }], [{ tag_name: "scratchpad-beta-v0.8.2" }]);
  assert.throws(() => assertReleaseAvailable("v1.0.0", [{ ref: "refs/tags/v1.0.0" }], []), /already exists/);
  assert.throws(() => assertReleaseAvailable("v1.0.0", [], [{ tag_name: "v1.0.0", draft: true }]), /already exists/);
  for (const [refs, releases] of [[{}, []], [[], {}], [[{}], []], [[], [null]]]) {
    assert.throws(() => assertReleaseAvailable("v1.0.0", refs, releases), /Invalid GitHub/);
  }
});

const commit = "a".repeat(40);
const digest = content => createHash("sha256").update(content).digest("hex");
async function fixture(t) {
  const assetsDir = await mkdtemp(join(tmpdir(), "scratchpad-stable-draft-"));
  t.after(() => rm(assetsDir, { recursive: true, force: true }));
  const names = expectedAssets("1.0.0");
  const contents = new Map(names.map(name => [name, Buffer.from(`final signed bytes for ${name}`)]));
  contents.set("SHA256SUMS", Buffer.from(names.filter(name => /_amd64\.(AppImage|deb)$/.test(name))
    .map(name => `${digest(contents.get(name))}  ${name}`).join("\n") + "\n"));
  const assets = [];
  for (const [name, bytes] of contents) {
    await writeFile(join(assetsDir, name), bytes);
    assets.push({ name, state: "uploaded", size: bytes.length, digest: `sha256:${digest(bytes)}`,
      browser_download_url: `https://github.com/crims0n/scratchpad/releases/download/v1.0.0/${name}` });
  }
  const release = { tag_name: "v1.0.0", name: "Scratchpad v1.0.0", target_commitish: commit, draft: true, prerelease: false, assets };
  return { release, assetsDir, version: "1.0.0", commit };
}

test("complete draft verification hashes all eight final files and recognizes the stable installers", async t => {
  const input = await fixture(t);
  const report = await verifyDraft(input);
  assert.equal(report.tag, "v1.0.0");
  assert.equal(report.assets.length, 8);
  assert.ok(report.assets.every(asset => /^[a-f0-9]{64}$/.test(asset.sha256)));
  assert.equal(input.release.draft, true);
});

test("draft verification rejects wrong identity, source, publication state, or incomplete asset sets", async t => {
  const input = await fixture(t);
  for (const override of [
    { prerelease: true }, { draft: false }, { tag_name: "scratchpad-beta-v1.0.0" },
    { target_commitish: "main" }, { name: "Scratchpad Beta v1.0.0" }, { assets: input.release.assets.slice(1) }
  ]) {
    await assert.rejects(verifyDraft({ ...input, release: { ...input.release, ...override } }));
  }
});

test("draft verification rejects corrupted downloads even when their size is unchanged", async t => {
  const input = await fixture(t);
  const asset = input.release.assets[0];
  await writeFile(join(input.assetsDir, asset.name), Buffer.alloc(asset.size, 0));
  await assert.rejects(verifyDraft(input), /SHA-256 mismatch/);
});

test("draft verification requires uploaded assets, valid digests, and exact Linux checksum coverage", async t => {
  const input = await fixture(t);
  const asset = input.release.assets[0];
  for (const override of [{ state: "new" }, { digest: null }]) {
    const release = { ...input.release, assets: [{ ...asset, ...override }, ...input.release.assets.slice(1)] };
    await assert.rejects(verifyDraft({ ...input, release }), /final upload metadata/);
  }
  const manifest = input.release.assets.find(asset => asset.name === "SHA256SUMS");
  const wrong = Buffer.from(`${"0".repeat(64)}  Scratchpad_1.0.0_amd64.AppImage\n`);
  await writeFile(join(input.assetsDir, manifest.name), wrong);
  Object.assign(manifest, { size: wrong.length, digest: `sha256:${digest(wrong)}` });
  await assert.rejects(verifyDraft(input), /Signed Linux manifest/);
});
