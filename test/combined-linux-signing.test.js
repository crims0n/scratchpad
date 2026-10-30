// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { hashFile, platformAssetNames, readVerificationEvidence } from "../scripts/release-verification.mjs";
import { verifyAppImageSignature, appImageSigningData } from "../scripts/appimage-signature.mjs";
import { appImageFixture } from "./helpers/appimage-fixture.js";
import { verifyLinuxAssets } from "../scripts/release-signature.mjs";

test("Linux handoffs authenticate embedded AppImages and one four-package checksum pair", { skip: process.platform === "win32", timeout: 30000 }, async t => {
  try {
    for (const tool of ["gpg", "gpgconf", "gpgv", "sha256sum"]) execFileSync(tool, ["--version"], { stdio: "pipe" });
  } catch (cause) {
    if (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true") throw new Error("Linux signing regression requires GnuPG and sha256sum", { cause });
    t.skip("Linux signing regression requires GnuPG and sha256sum");
    return;
  }
  const root = await mkdtemp("/tmp/sp-combined-");
  const home = join(root, "gpg");
  t.after(async () => {
    try {
      execFileSync("gpgconf", ["--homedir", home, "--kill", "gpg-agent"], { stdio: "pipe" });
      execFileSync("gpgconf", ["--homedir", home, "--remove-socketdir"], { stdio: "pipe" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  await mkdir(home, { mode: 0o700 });
  const gpg = args => execFileSync("gpg", ["--batch", "--no-options", "--homedir", home,
    "--pinentry-mode", "loopback", "--passphrase", "", ...args], { stdio: "pipe", encoding: "utf8" });
  gpg(["--quick-generate-key", "Scratchpad combined test <combined@example.invalid>", "ed25519", "sign", "0"]);
  const fingerprint = /^fpr:::::::::([A-F0-9]{40}):/m.exec(gpg(["--list-secret-keys", "--with-colons"]))[1];
  const publicKey = join(root, "public.asc");
  await writeFile(publicKey, gpg(["--armor", "--export", fingerprint]));
  const assets = join(root, "assets");
  const records = join(root, "records");
  const aggregate = join(root, "aggregate");
  for (const directory of [assets, records, aggregate]) await mkdir(directory);
  const scripts = fileURLToPath(new URL("../scripts/", import.meta.url));
  const env = { ...process.env, GNUPGHOME: home, RUNNER_TEMP: root, SIGNING_KEY_FINGERPRINT: fingerprint,
    RELEASE_ID: "123", RELEASE_VERSION: "1.0.0", GITHUB_SHA: "a".repeat(40), GITHUB_RUN_ID: "456" };
  const targets = ["x64", "arm64"].map(architecture => ({ platform: "linux", architecture }));
  for (const { architecture } of targets) {
    const [appimage, deb] = platformAssetNames("1.0.0", "linux", architecture);
    const fixture = appImageFixture(architecture, `synthetic ${architecture} payload`);
    const digestPath = join(root, `${architecture}-digest`);
    await writeFile(digestPath, fixture.digest);
    gpg(["--armor", "--detach-sign", digestPath]);
    const signature = await readFile(`${digestPath}.asc`);
    signature.copy(fixture.bytes, fixture.signatureOffset);
    (await readFile(publicKey)).copy(fixture.bytes, fixture.keyOffset);
    const appimagePath = join(assets, appimage);
    await writeFile(appimagePath, fixture.bytes);
    assert.equal((await appImageSigningData(appimagePath)).digest, fixture.digest);
    await verifyAppImageSignature(appimagePath, publicKey);
    const modified = Buffer.from(fixture.bytes);
    modified[fixture.payloadOffset] ^= 1;
    await writeFile(appimagePath, modified);
    await assert.rejects(verifyAppImageSignature(appimagePath, publicKey), /did not verify/);
    await writeFile(appimagePath, fixture.bytes);
    await writeFile(join(assets, deb), `synthetic ${architecture} Debian package`);
    execFileSync("bash", [join(scripts, "sign-linux-release.sh"), publicKey, "--assets-dir", assets,
      "--architecture", architecture, "--packages-only"], { stdio: "pipe", env: { ...env, RELEASE_ARCHITECTURE: architecture,
      VERIFICATION_EVIDENCE_PATH: join(records, `linux-${architecture}.json`) } });
  }
  // A real signature from the trusted key, copied from another image, must
  // fail rather than passing merely because its issuer fingerprint matches.
  const [first, second] = targets.map(target => join(assets, platformAssetNames("1.0.0", "linux", target.architecture)[0]));
  const firstBytes = await readFile(first);
  const secondBytes = await readFile(second);
  const copied = Buffer.from(secondBytes);
  firstBytes.copy(copied, 512, 512, 4608);
  await writeFile(second, copied);
  await assert.rejects(verifyAppImageSignature(second, publicKey), /did not verify/);
  await writeFile(second, secondBytes);
  await assert.rejects(verifyAppImageSignature(first, fileURLToPath(new URL("../site/release-signing-key.asc", import.meta.url))), /did not verify/);
  for (const args of [["--architecture", "x64"], ["--architecture", "all", "--packages-only"]]) {
    assert.throws(() => execFileSync("bash", [join(scripts, "sign-linux-release.sh"), publicKey,
      "--assets-dir", assets, ...args], { stdio: "pipe", env: { ...env, VERIFICATION_EVIDENCE_PATH: join(root, "invalid.json") } }),
      /requires both architectures|requires one stable architecture/);
  }
  assert.equal((await readdir(assets)).length, 4, "build jobs must not create competing checksum files");
  const handoffEnv = { ...env, RELEASE_ASSETS_DIR: assets, VERIFICATION_EVIDENCE_DIR: records };
  const handoff = () => execFileSync(process.execPath, [join(scripts, "verify-linux-handoff.mjs")], { env: handoffEnv, stdio: "pipe" });
  handoff();
  const file = join(assets, platformAssetNames("1.0.0", "linux", "arm64")[1]);
  const original = await readFile(file);
  await writeFile(file, "changed package");
  assert.throws(handoff, /signature-checked bytes/);
  await writeFile(file, original);
  execFileSync("bash", [join(scripts, "sign-linux-release.sh"), publicKey, "--assets-dir", assets, "--architecture", "all"],
    { stdio: "pipe", env: { ...env, RELEASE_ARCHITECTURE: "checksums", VERIFICATION_EVIDENCE_PATH: join(aggregate, "linux-checksums.json") } });
  const verified = await Promise.all((await readdir(assets)).map(name => hashFile(join(assets, name))));
  await verifyLinuxAssets({ assetsDir: assets, verified, publicKey });
  assert.equal((await readFile(join(assets, "SHA256SUMS"), "utf8")).trim().split("\n").length, 4);
  const checksums = await readVerificationEvidence(aggregate, [{ platform: "linux", architecture: "checksums" }]);
  assert.deepEqual(checksums[0].assets.map(asset => asset.name), ["SHA256SUMS", "SHA256SUMS.asc"]);
  const before = await readVerificationEvidence(records, targets);
  for (const record of before) for (const asset of record.assets) assert.deepEqual(await hashFile(join(assets, asset.name)), asset);
});
