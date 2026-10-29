// SPDX-License-Identifier: GPL-3.0-or-later

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { recordLinuxSigningValidation, hashFile } from "../scripts/release-verification.mjs";

async function fixture(t, architecture = "arm64") {
  const root = await mkdtemp(join(tmpdir(), "scratchpad-signing-record-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const suffixes = architecture === "arm64" ? ["aarch64.AppImage", "arm64.deb"] : ["amd64.AppImage", "amd64.deb"];
  const files = [...suffixes.map(suffix => `Scratchpad Development_1.0.0_${suffix}`), "SHA256SUMS", "SHA256SUMS.asc"].map(name => join(root, name));
  for (const file of files) await writeFile(file, `signature-checked test bytes: ${basename(file)}`);
  return { root, architecture, files, fingerprint: "A".repeat(40), commit: "b".repeat(40), runId: "123", runAttempt: "2" };
}

for (const architecture of ["arm64", "x64"]) {
  test(`${architecture} Linux signing record covers final hashes and run provenance`, async t => {
    const input = await fixture(t, architecture);
    const report = await recordLinuxSigningValidation(input);
    assert.equal(report.platform, "linux");
    assert.equal(report.method, "gpg");
    assert.equal(report.architecture, architecture);
    assert.equal(report.commit, input.commit);
    assert.equal(report.runAttempt, "2");
    assert.deepEqual(report.assets, await Promise.all(input.files.map(hashFile)));
  });
}

test("Linux signing records reject incomplete/mixed architectures and missing provenance", async t => {
  const input = await fixture(t);
  for (const override of [{ architecture: "x64" }, { architecture: "unknown" }, { files: input.files.slice(1) },
    { files: [input.files[0], input.files[0], ...input.files.slice(2)] }, { fingerprint: "wrong" },
    { commit: "main" }, { runId: "0" }, { runAttempt: "" }]) {
    await assert.rejects(recordLinuxSigningValidation({ ...input, ...override }));
  }
});

test("Linux signing CLI records source from the repository while running in the asset directory", async t => {
  const input = await fixture(t);
  const output = join(input.root, "signing-evidence.json");
  const script = fileURLToPath(new URL("../scripts/record-linux-signing-validation.mjs", import.meta.url));
  const options = { cwd: input.root, env: { ...process.env, SIGNING_VALIDATION_EVIDENCE_PATH: output,
    GITHUB_RUN_ID: input.runId, GITHUB_RUN_ATTEMPT: input.runAttempt }, stdio: "pipe" };
  const args = [script, input.architecture, input.fingerprint, ...input.files.map(file => basename(file))];
  execFileSync(process.execPath, args, options);
  const report = JSON.parse(await readFile(output, "utf8"));
  assert.equal(report.commit, execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
  assert.deepEqual(report.assets, await Promise.all(input.files.map(hashFile)));
  assert.throws(() => execFileSync(process.execPath, args, options), /EEXIST/);
});
