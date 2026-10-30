// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { assertNativeToolchain } from "../scripts/check-native-toolchain.mjs";
import { appImageSigningData } from "../scripts/appimage-signature.mjs";
import { verifyLinuxPayloads } from "../scripts/verify-linux-release.mjs";
import { appImageFixture } from "./helpers/appimage-fixture.js";

test("one native-host guard rejects emulated Node.js and near-matching Rust hosts", () => {
  const input = { architecture: "arm64", target: "aarch64-pc-windows-msvc", nodeArchitecture: "arm64",
    rustDetails: "release: 1.98.0\nhost: aarch64-pc-windows-msvc\n" };
  assert.doesNotThrow(() => assertNativeToolchain(input));
  assert.throws(() => assertNativeToolchain({ ...input, nodeArchitecture: "x64" }), /Node.js/);
  assert.throws(() => assertNativeToolchain({ ...input, rustDetails: "release: 1.98.0\nhost: aarch64-pc-windows-msvc-extra\n" }), /Rust host/);
  assert.throws(() => assertNativeToolchain({ architecture: "x64", nodeArchitecture: "x64", target: "x86_64-unknown-linux-gnu",
    rustDetails: "release: 1.98.0\nhost: x86_64-unknown-linux-gnux32\n" }), /Rust host/);
  assert.throws(() => execFileSync(process.execPath, ["scripts/check-native-toolchain.mjs", "invalid", "invalid"], { stdio: "pipe" }));
});

test("Linux package inspection rejects wrong-architecture shared libraries and unnamed ELF helpers", async t => {
  const root = await mkdtemp(join(tmpdir(), "sp-payloads-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const architecture of ["x64", "arm64"]) {
    const base = join(root, architecture);
    const roots = [join(base, "deb"), join(base, "appimage")];
    const bytes = appImageFixture(architecture, "application").bytes;
    await mkdir(base);
    const built = join(base, "scratchpad");
    await writeFile(built, bytes);
    for (const directory of roots) {
      await mkdir(join(directory, "usr/bin"), { recursive: true });
      await mkdir(join(directory, "usr/lib"));
      await writeFile(join(directory, "usr/bin/scratchpad"), bytes);
      await writeFile(join(directory, "AppRun"), "#!/bin/sh\nexec usr/bin/scratchpad\n");
    }
    const library = Buffer.from(bytes.subarray(0, 64));
    library.writeUInt16LE(3, 16); library.writeBigUInt64LE(0n, 24);
    const path = join(roots[1], "usr/lib/libhelper.so.1");
    await writeFile(path, library);
    const input = { architecture, built, binaryName: "scratchpad", roots };
    assert.equal((await verifyLinuxPayloads(input)).elfFiles, 3);
    const wrong = Buffer.from(library);
    wrong.writeUInt16LE(architecture === "arm64" ? 62 : 183, 18);
    await writeFile(path, wrong);
    await assert.rejects(verifyLinuxPayloads(input), /bundled ELF payload.*libhelper/);
    await writeFile(path, library);
    const helper = join(roots[0], "usr/bin/helper-without-extension");
    await writeFile(helper, wrong);
    await assert.rejects(verifyLinuxPayloads(input), /bundled ELF payload.*helper-without/);
    await writeFile(helper, Buffer.from("\x7fELF"));
    await assert.rejects(verifyLinuxPayloads(input), /malformed/);
  }
});

test("AppImage metadata parsing rejects truncated, oversized, overlapping and duplicate signing sections", async t => {
  const root = await mkdtemp(join(tmpdir(), "sp-elf-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = appImageFixture("arm64", "payload").bytes;
  const path = join(root, "fixture.AppImage");
  const variants = [Buffer.alloc(12), Buffer.from(original), Buffer.from(original), Buffer.from(original), Buffer.from(original)];
  variants[1].writeBigUInt64LE(0xffffffffffffffffn, 40);
  variants[2].writeBigUInt64LE(512n, 64 + 2 * 64 + 24); // overlapping signature/key
  variants[3].writeUInt32LE(1, 64 + 2 * 64); // duplicate .sha256_sig name
  variants[4].writeBigUInt64LE(1024n * 1024n + 1n, 64 + 64 + 32);
  for (const bytes of variants) {
    await writeFile(path, bytes);
    await assert.rejects(appImageSigningData(path));
  }
});
