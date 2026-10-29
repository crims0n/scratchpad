// SPDX-License-Identifier: GPL-3.0-or-later

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("key import initializes a missing isolated GPG home before inspecting the public key", { skip: process.platform === "win32", timeout: 30000 }, async t => {
  // macOS agent sockets need a short path; every key/home here is disposable.
  const root = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "scratchpad-gpg-"));
  const sourceHome = join(root, "source");
  const importHome = join(root, "fresh");
  await mkdir(sourceHome, { mode: 0o700 });
  t.after(async () => {
    for (const home of [sourceHome, importHome]) {
      try { execFileSync("gpgconf", ["--homedir", home, "--kill", "gpg-agent"], { stdio: "pipe" }); } catch { /* home/agent may not exist */ }
    }
    await rm(root, { recursive: true, force: true });
  });
  const passphrase = "disposable-import-test";
  const gpg = args => execFileSync("gpg", ["--batch", "--no-options", "--homedir", sourceHome,
    "--pinentry-mode", "loopback", "--passphrase", passphrase, ...args], { stdio: "pipe", encoding: "utf8" });
  gpg(["--quick-generate-key", "Scratchpad disposable import test <import@example.invalid>", "ed25519", "sign", "0"]);
  const fingerprint = /^fpr:::::::::([A-F0-9]{40}):/m.exec(gpg(["--list-secret-keys", "--with-colons"]))?.[1];
  assert.ok(fingerprint);
  const publicKey = join(root, "public.asc");
  await writeFile(publicKey, gpg(["--armor", "--export", fingerprint]));
  const secretKey = gpg(["--armor", "--export-secret-keys", fingerprint]);
  const output = join(root, "output.txt");
  await assert.rejects(stat(importHome), /ENOENT/);
  const script = fileURLToPath(new URL("../scripts/import-release-signing-key.sh", import.meta.url));
  const result = execFileSync("bash", [script, publicKey], { encoding: "utf8", stdio: "pipe", env: {
    ...process.env, GNUPGHOME: importHome, RELEASE_SIGNING_GPG_PRIVATE_KEY: secretKey,
    RELEASE_SIGNING_GPG_PASSPHRASE: passphrase, GITHUB_OUTPUT: output
  } });
  assert.match(result, /Imported release-signing key/);
  assert.equal((await stat(importHome)).mode & 0o777, 0o700);
  assert.equal((await readFile(output, "utf8")).trim(), `fingerprint=${fingerprint}`);
  // Use the imported key without supplying a passphrase, just as the bundler does.
  const signature = execFileSync("gpg", ["--batch", "--homedir", importHome, "--local-user", fingerprint,
    "--armor", "--detach-sign"], { input: "import regression", stdio: ["pipe", "pipe", "pipe"], encoding: "utf8" });
  assert.match(signature, /BEGIN PGP SIGNATURE/);
  const signatureFile = join(root, "import-test.asc");
  await writeFile(signatureFile, signature);
  execFileSync("gpg", ["--batch", "--no-options", "--homedir", sourceHome, "--verify", signatureFile, "-"],
    { input: "import regression", stdio: ["pipe", "pipe", "pipe"] });
});
