// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { hashFile, platformAssetNames, readVerificationEvidence } from "../scripts/release-verification.mjs";
import { verifyLinuxAssets } from "../scripts/release-signature.mjs";

test("native Linux handoffs produce one authenticated four-package checksum pair", { skip: process.platform !== "linux", timeout: 30000 }, async t => {
  try {
    for (const tool of ["gpg", "gpgconf", "gpgv", "llvm-objcopy", "cc"]) execFileSync(tool, ["--version"], { stdio: "pipe" });
  } catch (cause) {
    if (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true") throw new Error("Linux signing regression requires GnuPG, LLVM and cc", { cause });
    t.skip("Linux signing regression requires GnuPG, LLVM and cc");
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
  const input = join(root, "input");
  await writeFile(input, "synthetic AppImage signature-section fixture");
  gpg(["--armor", "--detach-sign", input]);
  const binary = join(root, "application");
  execFileSync("cc", ["-x", "c", "-", "-o", binary], { input: "int main(void) { return 0; }", stdio: ["pipe", "pipe", "pipe"] });
  const assets = join(root, "assets");
  const records = join(root, "records");
  const aggregate = join(root, "aggregate");
  for (const directory of [assets, records, aggregate]) await mkdir(directory);
  const scripts = fileURLToPath(new URL("../scripts/", import.meta.url));
  const env = { ...process.env, GNUPGHOME: home, RUNNER_TEMP: root, SIGNING_KEY_FINGERPRINT: fingerprint,
    RELEASE_ID: "123", RELEASE_VERSION: "1.0.0", GITHUB_SHA: "a".repeat(40), GITHUB_RUN_ID: "456", OBJCOPY: "llvm-objcopy" };
  const targets = ["x64", "arm64"].map(architecture => ({ platform: "linux", architecture }));
  for (const { architecture } of targets) {
    const [appimage, deb] = platformAssetNames("1.0.0", "linux", architecture);
    // Synthetic ELF containers exercise LLVM's handling of both machine types.
    // Actual package architecture/installability is established by native jobs.
    const bytes = await readFile(binary);
    bytes.writeUInt16LE(architecture === "arm64" ? 183 : 62, 18);
    const source = join(root, architecture);
    await writeFile(source, bytes);
    execFileSync("llvm-objcopy", ["--add-section", `.sha256_sig=${input}.asc`, source, join(assets, appimage)], { stdio: "pipe" });
    await writeFile(join(assets, deb), `synthetic ${architecture} Debian package`);
    execFileSync("bash", [join(scripts, "sign-linux-release.sh"), publicKey, "--assets-dir", assets,
      "--architecture", architecture, "--packages-only"], { stdio: "pipe", env: { ...env, RELEASE_ARCHITECTURE: architecture,
      VERIFICATION_EVIDENCE_PATH: join(records, `linux-${architecture}.json`) } });
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
