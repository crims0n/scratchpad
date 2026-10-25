// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stableRelease, assertReleaseAvailable } from "../scripts/check-stable-release.mjs";
import { expectedAssets, downloadDraftAssets, verifyDraft } from "../scripts/verify-release-draft.mjs";
import { prepareDraft } from "../scripts/prepare-stable-release.mjs";
import { platformAssetNames, platforms, recordVerification } from "../scripts/release-verification.mjs";

// Public test key and signature only; the disposable private key was deleted.
const publicKey = fileURLToPath(new URL("./fixtures/release-verification/public-key.asc", import.meta.url));

test("only canonical stable versions starting at 1.0.0 can create releases", () => {
  assert.deepEqual(stableRelease("1.0.0"), { version: "1.0.0", tag: "v1.0.0", name: "Scratchpad v1.0.0" });
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
const releaseId = 123;
const runId = "456";

function preparation({ refs = [], pages = [[]], errorAt = 0, response = {} } = {}) {
  const calls = [];
  const input = { ref: "refs/heads/main", repository: "crims0n/scratchpad", version: "1.0.0", commit, body: "Release notes and verification instructions", api: async (args, body) => {
    calls.push({ args, body });
    if (calls.length === errorAt) throw new Error("GitHub authentication or network failure");
    if (body) return { ...body, id: releaseId, ...response };
    return args[0] === "--paginate" ? pages : refs;
  } };
  return { input, calls };
}

test("preparation checks availability then creates exactly one unpublished draft for the source commit", async () => {
  const { input, calls } = preparation();
  assert.deepEqual(await prepareDraft(input), { version: "1.0.0", tag: "v1.0.0", name: "Scratchpad v1.0.0", releaseId });
  assert.equal(calls.length, 3);
  const writes = calls.filter(call => call.body);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { args: ["repos/crims0n/scratchpad/releases"], body: {
    tag_name: "v1.0.0", name: "Scratchpad v1.0.0", body: input.body,
    draft: true, prerelease: false, target_commitish: commit, generate_release_notes: true
  } });
});

test("existing drafts, tag reuse, and failed lookups stop preparation before any write", async () => {
  for (const options of [
    { pages: [[{ tag_name: "v1.0.0", draft: true }]] },
    { refs: [{ ref: "refs/tags/v1.0.0" }] }, { errorAt: 1 }, { errorAt: 2 }, { pages: {} }
  ]) {
    const { input, calls } = preparation(options);
    await assert.rejects(prepareDraft(input));
    assert.equal(calls.some(call => call.body), false);
  }
});

test("preparation requires main and rejects malformed creation responses without retrying", async () => {
  const { input, calls } = preparation();
  await assert.rejects(prepareDraft({ ...input, ref: "refs/heads/feature" }), /must run from main/);
  assert.equal(calls.length, 0);
  for (const response of [{ id: null }, { draft: false }, { target_commitish: "main" }, { tag_name: "v2.0.0" }]) {
    const attempt = preparation({ response });
    await assert.rejects(prepareDraft(attempt.input), /expected candidate draft/);
    assert.equal(attempt.calls.filter(call => call.body).length, 1);
  }
});

const digest = content => createHash("sha256").update(content).digest("hex");
async function fixture(t) {
  const assetsDir = await mkdtemp(join(tmpdir(), "scratchpad-stable-draft-"));
  t.after(() => rm(assetsDir, { recursive: true, force: true }));
  const names = expectedAssets("1.0.0");
  const contents = new Map(names.map(name => [name, Buffer.from(`final signed bytes for ${name}`)]));
  contents.set("SHA256SUMS", Buffer.from(names.filter(name => /_amd64\.(AppImage|deb)$/.test(name))
    .map(name => `${digest(contents.get(name))}  ${name}`).join("\n") + "\n"));
  contents.set("SHA256SUMS.asc", await readFile(new URL("./fixtures/release-verification/SHA256SUMS.asc", import.meta.url)));
  const assets = [];
  for (const [name, bytes] of contents) {
    await writeFile(join(assetsDir, name), bytes);
    assets.push({ id: assets.length + 1, name, state: "uploaded", size: bytes.length, digest: `sha256:${digest(bytes)}`,
      browser_download_url: `https://github.com/crims0n/scratchpad/releases/download/v1.0.0/${name}` });
  }
  const release = { id: releaseId, tag_name: "v1.0.0", name: "Scratchpad v1.0.0", target_commitish: commit, draft: true, prerelease: false, assets };
  const version = "1.0.0";
  const evidence = await Promise.all(platforms.map(platform => recordVerification({ platform,
    files: platformAssetNames(version, platform).map(name => join(assetsDir, name)), releaseId, version, commit, runId })));
  return { release, releaseId, assetsDir, version, commit, runId, evidence, publicKey };
}

test("complete draft verification hashes all eight final files and recognizes the stable installers", async t => {
  const input = await fixture(t);
  const report = await verifyDraft(input);
  assert.equal(report.tag, "v1.0.0");
  assert.equal(report.assets.length, 8);
  assert.ok(report.assets.every(asset => /^[a-f0-9]{64}$/.test(asset.sha256)));
  assert.equal(input.release.draft, true);
});

test("downloads use exactly the selected draft's asset IDs, then verify those bytes", async t => {
  const input = await fixture(t);
  const assetsDir = join(input.assetsDir, "downloaded");
  const ids = [];
  await downloadDraftAssets({ ...input, assetsDir, download: async (id, destination) => {
    ids.push(id);
    const asset = input.release.assets.find(asset => asset.id === id);
    await writeFile(destination, await readFile(join(input.assetsDir, asset.name)));
  } });
  assert.deepEqual(ids, input.release.assets.map(asset => asset.id));
  assert.equal((await verifyDraft({ ...input, assetsDir })).releaseId, releaseId);
  await assert.rejects(downloadDraftAssets({ ...input, assetsDir, download: () => assert.fail("must not reuse a download directory") }), /EEXIST/);
});

test("wrong release IDs, duplicate asset IDs and unsafe names are rejected before downloading", async t => {
  const input = await fixture(t);
  const assetsDir = join(input.assetsDir, "must-not-exist");
  for (const override of [
    { releaseId: releaseId + 1 },
    { release: { ...input.release, assets: input.release.assets.map(asset => ({ ...asset, id: 1 })) } },
    { release: { ...input.release, assets: [{ ...input.release.assets[0], name: "../outside" }, ...input.release.assets.slice(1)] } }
  ]) {
    await assert.rejects(downloadDraftAssets({ ...input, ...override, assetsDir, download: () => assert.fail("must not download invalid metadata") }));
  }
  await assert.rejects(stat(assetsDir), /ENOENT/);
});

test("a failed asset download stops without fetching later assets", async t => {
  const input = await fixture(t);
  const ids = [];
  await assert.rejects(downloadDraftAssets({ ...input, assetsDir: join(input.assetsDir, "partial"), download: async id => {
    ids.push(id);
    throw new Error("asset download failed");
  } }), /asset download failed/);
  assert.deepEqual(ids, [input.release.assets[0].id]);
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

test("replacing any uploaded file cannot pass by updating GitHub's digest", async t => {
  const input = await fixture(t);
  for (const asset of input.release.assets) {
    const original = await readFile(join(input.assetsDir, asset.name));
    const replacement = Buffer.from(`unverified replacement for ${asset.name}`);
    await writeFile(join(input.assetsDir, asset.name), replacement);
    const release = { ...input.release, assets: input.release.assets.map(file => file.name === asset.name
      ? { ...file, size: replacement.length, digest: `sha256:${digest(replacement)}` } : file) };
    await assert.rejects(verifyDraft({ ...input, release }), /signature-checked bytes|Signed Linux manifest/);
    await writeFile(join(input.assetsDir, asset.name), original);
  }
});

test("verification records must cover all platforms from this candidate and run", async t => {
  const input = await fixture(t);
  for (const evidence of [undefined, [], input.evidence.slice(1), [input.evidence[0], input.evidence[0], input.evidence[2]]]) {
    await assert.rejects(verifyDraft({ ...input, evidence }), /one verification record per platform/);
  }
  for (const override of [{ releaseId: releaseId + 1 }, { commit: "b".repeat(40) }, { version: "1.0.1" },
    { runId: "999" }, { schemaVersion: 2 }, { assets: input.evidence[0].assets.slice(1) }]) {
    const evidence = [{ ...input.evidence[0], ...override }, ...input.evidence.slice(1)];
    await assert.rejects(verifyDraft({ ...input, evidence }), /Verification evidence/);
  }
});

test("a recorded Linux signature must still cryptographically verify with the public key", async t => {
  const input = await fixture(t);
  const name = "SHA256SUMS.asc";
  const bytes = Buffer.from("not a GPG signature");
  await writeFile(join(input.assetsDir, name), bytes);
  Object.assign(input.release.assets.find(asset => asset.name === name), { size: bytes.length, digest: `sha256:${digest(bytes)}` });
  Object.assign(input.evidence.find(record => record.platform === "linux").assets.find(asset => asset.name === name),
    { size: bytes.length, sha256: digest(bytes) });
  await assert.rejects(verifyDraft(input), /checksum signature did not verify/);
});

test("a valid signature from an untrusted key is rejected", async t => {
  const input = await fixture(t);
  await assert.rejects(verifyDraft({ ...input, publicKey: fileURLToPath(new URL("../site/release-signing-key.asc", import.meta.url)) }),
    /checksum signature did not verify/);
});

test("platform records reject incomplete files and missing candidate identity", async t => {
  const input = await fixture(t);
  const platform = "windows";
  const files = platformAssetNames(input.version, platform).map(name => join(input.assetsDir, name));
  for (const override of [{ files: files.slice(1) }, { files: [files[0], files[0]] }, { platform: "other" },
    { releaseId: 0 }, { runId: undefined }, { commit: "main" }]) {
    await assert.rejects(recordVerification({ ...input, platform, files, ...override }));
  }
});

test("the platform recording command writes candidate provenance and refuses an existing record", async t => {
  const input = await fixture(t);
  const output = join(input.assetsDir, "evidence", "windows.json");
  const args = [fileURLToPath(new URL("../scripts/release-verification.mjs", import.meta.url)), "windows",
    ...platformAssetNames(input.version, "windows").map(name => join(input.assetsDir, name))];
  const options = { env: { ...process.env, VERIFICATION_EVIDENCE_PATH: output, RELEASE_ID: String(releaseId),
    RELEASE_VERSION: input.version, GITHUB_SHA: commit, GITHUB_RUN_ID: runId }, stdio: "pipe" };
  execFileSync(process.execPath, args, options);
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), input.evidence.find(record => record.platform === "windows"));
  assert.throws(() => execFileSync(process.execPath, args, options), /EEXIST/);
});
