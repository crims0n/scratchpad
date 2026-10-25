// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stableRelease, assertReleaseAvailable } from "../scripts/check-stable-release.mjs";
import { expectedAssets, downloadDraftAssets, verifyDraft } from "../scripts/verify-release-draft.mjs";
import { prepareDraft } from "../scripts/prepare-stable-release.mjs";
import { platformAssetNames, platforms, recordVerification } from "../scripts/release-verification.mjs";
import { uploadVerifiedDraft } from "../scripts/upload-release-draft.mjs";
import { confirmVerifiedDraft } from "../scripts/confirm-release-draft.mjs";

// Public test key and signature only; the disposable private key was deleted.
const publicKey = fileURLToPath(new URL("./fixtures/release-verification/public-key.asc", import.meta.url));

test("only canonical stable versions starting at 1.0.0 can create releases", () => {
  assert.deepEqual(stableRelease("1.0.0"), { version: "1.0.0", tag: "v1.0.0", name: "Scratchpad v1.0.0" });
  assert.equal(stableRelease("2.10.3").tag, "v2.10.3");
  assert.equal(stableRelease("9007199254740991.0.0").version, "9007199254740991.0.0");
  for (const invalid of ["0.8.2", "1.0.0-beta.1", "1.0.0+build", "v1.0.0", " 1.0.0 ", "1.0", "01.0.0", "1.00.0",
    "1.0.00", "9007199254740992.0.0", "1.9007199254740992.0", "1.0.9007199254740992", "garbage", undefined]) {
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
  Object.assign(input.evidence.find(record => record.platform === "linux").assets.find(asset => asset.name === manifest.name),
    { size: wrong.length, sha256: digest(wrong) });
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

async function uploadFixture(t, initialAssets = []) {
  const input = await fixture(t);
  const root = await mkdtemp(join(tmpdir(), "scratchpad-draft-upload-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const remote = { ...structuredClone(input.release), assets: structuredClone(initialAssets) };
  const calls = [];
  const bytes = new Map(await Promise.all(input.release.assets.map(async asset =>
    [asset.id, await readFile(join(input.assetsDir, asset.name))])));
  let nextId = 1000;
  const github = {
    release: async () => { calls.push(["release"]); return structuredClone(remote); },
    deleteAsset: async id => {
      calls.push(["delete", id]);
      assert.ok(remote.assets.some(asset => asset.id === id));
      remote.assets = remote.assets.filter(asset => asset.id !== id);
      bytes.delete(id);
    },
    uploadAsset: async (file, name, type) => {
      calls.push(["upload", name, type]);
      assert.equal(remote.assets.some(asset => asset.name === name), false);
      const content = await readFile(file);
      const asset = { ...input.release.assets.find(asset => asset.name === name), id: nextId++,
        size: content.length, digest: `sha256:${digest(content)}` };
      remote.assets.push(asset);
      bytes.set(asset.id, content);
      return structuredClone(asset);
    },
    asset: async id => { calls.push(["asset", id]); return structuredClone(remote.assets.find(asset => asset.id === id)); },
    downloadAsset: async (id, destination) => { calls.push(["download", id]); await writeFile(destination, bytes.get(id), { flag: "wx" }); }
  };
  return { input: { ...input, repository: "crims0n/scratchpad", key: publicKey, snapshotDir: join(root, "snapshot"), github,
    sleep: async () => {} }, remote, calls, bytes };
}

test("the uploader verifies signed handoffs, uploads eight files, and snapshots downloads by asset ID", async t => {
  const { input, remote, calls } = await uploadFixture(t);
  const result = await uploadVerifiedDraft(input);
  assert.equal(result.assets.length, 8);
  assert.equal(remote.draft, true);
  assert.equal(calls.filter(([op]) => op === "upload").length, 8);
  assert.equal(calls.find(([op, name]) => op === "upload" && name.endsWith(".dmg"))[2], "application/x-apple-diskimage");
  for (const name of ["SHA256SUMS", "SHA256SUMS.asc"]) {
    assert.equal(calls.find(([op, file]) => op === "upload" && file === name)[2], "text/plain");
  }
  assert.equal(calls.some(([op]) => op === "delete"), false);
  assert.deepEqual(calls.filter(([op]) => op === "download").map(([, id]) => id), remote.assets.map(asset => asset.id));
  const release = JSON.parse(await readFile(join(input.snapshotDir, "release.json"), "utf8"));
  assert.deepEqual(release, remote);
  assert.equal((await verifyDraft({ ...input, release, assetsDir: join(input.snapshotDir, "assets") })).assets.length, 8);
});

test("invalid files, signing evidence, and Linux signatures are rejected before contacting GitHub", async t => {
  const { input, calls } = await uploadFixture(t);
  for (const override of [{ runId: "999" }, { commit: "b".repeat(40) }, { releaseId: 999 }, { evidence: [] },
    { key: fileURLToPath(new URL("../site/release-signing-key.asc", import.meta.url)) }]) {
    await assert.rejects(uploadVerifiedDraft({ ...input, ...override }));
  }
  const file = join(input.assetsDir, input.release.assets[0].name);
  const original = await readFile(file);
  await writeFile(file, Buffer.alloc(original.length));
  await assert.rejects(uploadVerifiedDraft(input), /signature-checked bytes/);
  await writeFile(file, original);
  await writeFile(join(input.assetsDir, "unexpected.exe"), "extra");
  await assert.rejects(uploadVerifiedDraft(input), /exactly the eight/);
  assert.deepEqual(calls, []);
});

test("wrong, published, retargeted, and polluted drafts are rejected before any write", async t => {
  const { input, remote, calls } = await uploadFixture(t);
  for (const override of [{ id: 999 }, { target_commitish: "main" }, { draft: false }, { prerelease: true },
    { tag_name: "v1.0.1" }, { name: "other" }, { assets: [{ id: 44, name: "unexpected.exe" }] },
    { assets: [{ ...input.release.assets[0], id: -1 }] }]) {
    Object.assign(remote, input.release, { assets: [] }, override);
    await assert.rejects(uploadVerifiedDraft(input));
  }
  assert.ok(calls.every(([op]) => op === "release"));
  await assert.rejects(stat(input.snapshotDir), /ENOENT/);
});

test("a partial-upload retry keeps matching files and replaces only stale expected assets", async t => {
  const { input, remote, calls } = await uploadFixture(t);
  const matching = structuredClone(input.release.assets[0]);
  const stale = { ...input.release.assets[1], digest: `sha256:${"0".repeat(64)}` };
  remote.assets = [matching, stale];
  await uploadVerifiedDraft(input);
  assert.deepEqual(calls.filter(([op]) => op === "delete"), [["delete", stale.id]]);
  assert.equal(calls.filter(([op]) => op === "upload").length, 7);
  assert.equal(remote.assets.find(asset => asset.name === matching.name).id, matching.id);
});

test("a retry waits for an existing upload's delayed digest and retains matching files", async t => {
  const { input, remote, calls } = await uploadFixture(t);
  remote.assets = structuredClone(input.release.assets);
  const pending = remote.assets[0];
  const digest = pending.digest;
  pending.digest = null;
  let polls = 0;
  input.github.asset = async id => {
    assert.equal(id, pending.id);
    if (++polls === 2) pending.digest = digest;
    return structuredClone(pending);
  };
  await uploadVerifiedDraft(input);
  assert.equal(polls, 2);
  assert.equal(calls.some(([op]) => op === "upload" || op === "delete"), false);
});

test("a retry leaves existing bytes intact when their digest stays unavailable", async t => {
  const { input, remote, calls } = await uploadFixture(t);
  remote.assets = structuredClone(input.release.assets);
  remote.assets[0].digest = null;
  const before = structuredClone(remote.assets);
  let sleeps = 0;
  input.sleep = async () => { sleeps++; };
  await assert.rejects(uploadVerifiedDraft(input), /digest unavailable; retry later/);
  assert.equal(sleeps, 6);
  assert.deepEqual(remote.assets, before);
  assert.equal(calls.some(([op]) => op === "upload" || op === "delete"), false);
});

test("upload failures leave a recoverable draft, and a new attempt resumes without reuploading matching bytes", async t => {
  const { input, remote, calls } = await uploadFixture(t);
  const upload = input.github.uploadAsset;
  let attempts = 0;
  input.github.uploadAsset = (...args) => {
    if (++attempts === 3) throw new Error("temporary upload failure");
    return upload(...args);
  };
  await assert.rejects(uploadVerifiedDraft(input), /temporary upload failure/);
  assert.equal(remote.assets.length, 2);
  assert.equal(calls.some(([op]) => op === "download"), false);
  input.github.uploadAsset = upload;
  await uploadVerifiedDraft({ ...input, snapshotDir: `${input.snapshotDir}-retry` });
  assert.equal(calls.filter(([op]) => op === "upload").length, 8);
});

test("the uploader rechecks draft identity before replacing any file", async t => {
  const { input, remote, calls } = await uploadFixture(t);
  remote.assets = [{ ...input.release.assets[0], state: "new" }];
  const release = input.github.release;
  let reads = 0;
  input.github.release = () => {
    if (++reads === 2) remote.draft = false;
    return release();
  };
  await assert.rejects(uploadVerifiedDraft(input), /unpublished stable/);
  assert.ok(calls.every(([op]) => op === "release"));
});

test("GitHub digest availability is bounded and a mismatching upload stops before later writes", async t => {
  const { input, calls } = await uploadFixture(t);
  const upload = input.github.uploadAsset;
  input.github.uploadAsset = async (...args) => ({ ...await upload(...args), digest: null });
  await uploadVerifiedDraft(input);
  assert.equal(calls.filter(([op]) => op === "asset").length, 8);

  const bad = await uploadFixture(t);
  const badUpload = bad.input.github.uploadAsset;
  bad.input.github.uploadAsset = async (...args) => ({ ...await badUpload(...args), digest: `sha256:${"0".repeat(64)}` });
  await assert.rejects(uploadVerifiedDraft(bad.input), /Upload does not match/);
  assert.equal(bad.calls.filter(([op]) => op === "upload").length, 1);
  assert.equal(bad.calls.some(([op]) => op === "download"), false);

  const missing = await uploadFixture(t);
  const missingUpload = missing.input.github.uploadAsset;
  missing.input.github.uploadAsset = async (...args) => ({ ...await missingUpload(...args), digest: null });
  missing.input.github.asset = async () => ({ ...missing.remote.assets[0], digest: null });
  let sleeps = 0;
  missing.input.sleep = async () => { sleeps++; };
  await assert.rejects(uploadVerifiedDraft(missing.input), /Upload does not match/);
  assert.equal(sleeps, 6);
  assert.equal(missing.remote.assets.length, 1);
});

test("missing or substituted asset responses fail clearly while waiting for a digest", async t => {
  for (const response of [undefined, null, { id: 777, name: "other.exe", digest: `sha256:${"0".repeat(64)}` }]) {
    const { input, calls } = await uploadFixture(t);
    const upload = input.github.uploadAsset;
    input.github.uploadAsset = async (...args) => ({ ...await upload(...args), digest: null });
    input.github.asset = async () => response;
    await assert.rejects(uploadVerifiedDraft(input), /Upload does not match signature-checked bytes: .*missing or changed asset/);
    assert.equal(calls.filter(([op]) => op === "upload").length, 1);
    assert.equal(calls.some(([op]) => op === "download"), false);
  }
});

test("changed final metadata, downloaded bytes, or publication state cannot produce a verification snapshot", async t => {
  for (const mode of ["metadata", "download", "publication"]) {
    const { input, remote } = await uploadFixture(t);
    if (mode === "metadata") {
      const release = input.github.release;
      input.github.release = () => {
        if (remote.assets.length === 8) remote.assets[0].digest = `sha256:${"0".repeat(64)}`;
        return release();
      };
    } else if (mode === "download") {
      input.github.downloadAsset = (_, destination) => writeFile(destination, "unverified bytes");
    } else {
      const download = input.github.downloadAsset;
      input.github.downloadAsset = async (...args) => {
        await download(...args);
        remote.draft = false;
      };
    }
    await assert.rejects(uploadVerifiedDraft(input), /Final draft metadata changed|signature-checked bytes|unpublished stable/);
    await assert.rejects(stat(join(input.snapshotDir, "release.json")), /ENOENT/);
  }
});

test("a stale snapshot directory is rejected before mutating the draft", async t => {
  const { input, calls } = await uploadFixture(t);
  await mkdir(input.snapshotDir);
  await assert.rejects(uploadVerifiedDraft(input), /EEXIST/);
  assert.ok(calls.every(([op]) => op === "release"));
});

test("all write-privileged entry points load with only repository scripts and Node builtins", async t => {
  const root = await mkdtemp(join(tmpdir(), "scratchpad-no-npm-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ["check-stable-release", "prepare-stable-release", "release-verification", "release-signature", "upload-release-draft", "confirm-release-draft"]) {
    await copyFile(new URL(`../scripts/${name}.mjs`, import.meta.url), join(root, `${name}.mjs`));
  }
  execFileSync(process.execPath, ["--input-type=module", "-e",
    "await import('./prepare-stable-release.mjs'); await import('./upload-release-draft.mjs'); await import('./confirm-release-draft.mjs');"], { cwd: root, stdio: "pipe" });
});

test("final confirmation reads the live draft after snapshot verification and allows harmless metadata edits", async t => {
  const input = await fixture(t);
  const { verification } = await verifyDraft(input);
  assert.equal(verification.runId, runId);
  assert.equal(verification.release.assets.some(asset => "browser_download_url" in asset), false);
  let reads = 0;
  const result = await confirmVerifiedDraft({ ...input, repository: "crims0n/scratchpad", verification,
    github: { release: async () => {
      reads++;
      return { ...input.release, body: "edited release notes", assets: [...input.release.assets].reverse() };
    } } });
  assert.equal(reads, 1);
  assert.equal(result.assets.length, 8);
});

test("final confirmation rejects drift in the live draft even when the downloaded snapshot still verifies", async t => {
  const input = await fixture(t);
  const { verification } = await verifyDraft(input);
  const first = input.release.assets[0];
  for (const change of [{ id: releaseId + 1 }, { draft: false }, { prerelease: true }, { target_commitish: "b".repeat(40) },
    { tag_name: "v2.0.0" }, { assets: input.release.assets.slice(1) },
    { assets: [...input.release.assets, { id: 999, name: "extra.exe" }] },
    ...[{ id: 999 }, { digest: `sha256:${"0".repeat(64)}` }, { size: first.size + 1 }, { state: "new" }]
      .map(fields => ({ assets: [{ ...first, ...fields }, ...input.release.assets.slice(1)] }))]) {
    await assert.rejects(confirmVerifiedDraft({ ...input, repository: "crims0n/scratchpad", verification,
      github: { release: async () => ({ ...input.release, ...change }) } }));
  }
  assert.equal((await verifyDraft(input)).assets.length, 8);
});

test("final confirmation requires a valid verified result from the selected candidate and workflow run", async t => {
  const input = await fixture(t);
  const { verification } = await verifyDraft(input);
  const github = { release: () => assert.fail("must reject before fetching the draft") };
  for (const override of [{ verification: undefined }, { verification: { ...verification, schemaVersion: 2 } },
    { verification: { ...verification, runId: "999" } }, { releaseId: 999 }, { commit: "b".repeat(40) },
    { version: "1.0.1" }, { repository: "../other" }]) {
    await assert.rejects(confirmVerifiedDraft({ ...input, repository: "crims0n/scratchpad", verification, github, ...override }));
  }
});

test("a failed live-draft query cannot report confirmation success", async t => {
  const input = await fixture(t);
  const { verification } = await verifyDraft(input);
  await assert.rejects(confirmVerifiedDraft({ ...input, repository: "crims0n/scratchpad", verification,
    github: { release: async () => { throw new Error("GitHub unavailable"); } } }), /GitHub unavailable/);
});

test("the confirmation command reads the prepared draft by ID and reports live confirmation only on success", { skip: process.platform === "win32" }, async t => {
  const input = await fixture(t);
  const { verification } = await verifyDraft(input);
  const root = await mkdtemp(join(tmpdir(), "scratchpad-confirm-draft-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const releaseFile = join(root, "release.json");
  const summary = join(root, "summary.md");
  await writeFile(releaseFile, JSON.stringify(input.release));
  await writeFile(join(root, "gh"), '#!/bin/sh\n[ "$1" = api ] && [ "$2" = repos/crims0n/scratchpad/releases/123 ] || exit 2\ncat "$TEST_RELEASE_JSON"\n', { mode: 0o755 });
  const script = fileURLToPath(new URL("../scripts/confirm-release-draft.mjs", import.meta.url));
  const options = { encoding: "utf8", stdio: "pipe", env: { ...process.env,
    PATH: `${root}${delimiter}${process.env.PATH}`, TEST_RELEASE_JSON: releaseFile, GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "crims0n/scratchpad", RELEASE_ID: String(releaseId), RELEASE_VERSION: input.version,
    GITHUB_SHA: commit, GITHUB_RUN_ID: runId, VERIFIED_DRAFT: JSON.stringify(verification), GITHUB_STEP_SUMMARY: summary } };
  assert.match(execFileSync(process.execPath, [script], options), /Confirmed current stable draft/);
  assert.match(await readFile(summary, "utf8"), /Checked GitHub at .*all eight current asset IDs/);
  await rm(summary);
  await writeFile(releaseFile, JSON.stringify({ ...input.release, draft: false }));
  assert.throws(() => execFileSync(process.execPath, [script], options), /unpublished stable/);
  await assert.rejects(stat(summary), /ENOENT/);
  assert.throws(() => execFileSync(process.execPath, [script], {
    ...options, env: { ...options.env, GITHUB_REF: "refs/heads/feature" }
  }), /must run from main/);
});
