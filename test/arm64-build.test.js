// SPDX-License-Identifier: GPL-3.0-or-later

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { assertArm64Binary, parseRustToolchain, readApplicationHeader, verifyArm64Build } from "../scripts/verify-arm64-build.mjs";
import { hashFile } from "../scripts/release-verification.mjs";

function elf(machine = 183, type = 2) {
  const bytes = Buffer.alloc(120);
  bytes.write("\x7fELF");
  bytes[4] = 2;
  bytes[5] = 1;
  bytes.writeUInt16LE(type, 16);
  bytes.writeUInt16LE(machine, 18);
  bytes.writeBigUInt64LE(0x400100n, 24);
  bytes.writeBigUInt64LE(64n, 32);
  bytes.writeUInt16LE(56, 54);
  bytes.writeUInt16LE(1, 56);
  bytes.writeUInt32LE(3, 64); // PT_INTERP for the PIE fixture.
  return bytes;
}

function pe(machine = 0xaa64) {
  const bytes = Buffer.alloc(128);
  bytes.write("MZ");
  bytes.writeUInt32LE(64, 0x3c);
  bytes.writeUInt32LE(0x4550, 64);
  bytes.writeUInt16LE(machine, 68);
  bytes.writeUInt16LE(0x0002, 86); // IMAGE_FILE_EXECUTABLE_IMAGE.
  bytes.writeUInt16LE(0x20b, 88);
  return bytes;
}

test("ARM64 application checks distinguish native payloads from x64 and x86", () => {
  assert.doesNotThrow(() => assertArm64Binary(elf(), "linux"));
  assert.doesNotThrow(() => assertArm64Binary(pe(), "windows"));
  assert.throws(() => assertArm64Binary(elf(62), "linux"), /ELF64/);
  assert.throws(() => assertArm64Binary(pe(0x8664), "windows"), /PE32/);
  assert.throws(() => assertArm64Binary(pe(0x14c), "windows"), /PE32/);
  assert.throws(() => assertArm64Binary(pe(), "linux"), /ELF64/);
  assert.throws(() => assertArm64Binary(elf(), "windows"), /PE32/);
});

test("truncated, malformed and wrong-width headers cannot establish ARM64", () => {
  for (const platform of ["linux", "windows"]) {
    for (const bytes of [Buffer.alloc(0), Buffer.alloc(63), Buffer.alloc(128)]) {
      assert.throws(() => assertArm64Binary(bytes, platform));
    }
  }
  const elf32 = elf();
  elf32[4] = 1;
  assert.throws(() => assertArm64Binary(elf32, "linux"));
  const badOffset = pe();
  badOffset.writeUInt32LE(0xffffffff, 0x3c);
  assert.throws(() => assertArm64Binary(badOffset, "windows"), /PE32/);
  const badSignature = pe();
  badSignature.writeUInt32LE(0, 64);
  assert.throws(() => assertArm64Binary(badSignature, "windows"), /PE32/);
});

test("objects and libraries are rejected while ELF executables and dynamic PIE applications are accepted", () => {
  assert.doesNotThrow(() => assertArm64Binary(elf(183, 2), "linux"));
  assert.doesNotThrow(() => assertArm64Binary(elf(183, 3), "linux"));
  assert.throws(() => assertArm64Binary(elf(183, 1), "linux"), /executable/);
  const library = elf(183, 3);
  library.writeBigUInt64LE(0n, 24);
  assert.throws(() => assertArm64Binary(library, "linux"), /entry point/);
  library.writeBigUInt64LE(0x400100n, 24);
  library.writeUInt32LE(1, 64);
  assert.throws(() => assertArm64Binary(library, "linux"), /interpreter/);
  const object = pe();
  object.writeUInt16LE(0, 86);
  assert.throws(() => assertArm64Binary(object, "windows"), /executable image/);
  object.writeUInt16LE(0x2002, 86);
  assert.throws(() => assertArm64Binary(object, "windows"), /DLL/);
});

test("ELF program header tables must be complete and bounded", () => {
  const pie = elf(183, 3);
  assert.throws(() => assertArm64Binary(pie.subarray(0, 100), "linux"), /Truncated/);
  pie.writeBigUInt64LE(2n ** 63n, 32);
  assert.throws(() => assertArm64Binary(pie, "linux"), /oversized/);
});

test("Rust version and host survive both Unix and Windows verbose output", () => {
  for (const newline of ["\n", "\r\n"]) {
    const report = parseRustToolchain(["rustc 1.98.0 (test build)", "host: aarch64-pc-windows-msvc", "release: 1.98.0", "LLVM version: 22.1.0"].join(newline));
    assert.equal(report.host, "aarch64-pc-windows-msvc");
    assert.equal(report.version, "1.98.0");
    assert.match(report.details, /LLVM version/);
  }
  assert.throws(() => parseRustToolchain("rustc 1.98.0"), /version and host/);
});

async function fixture(t, platform) {
  const dir = await mkdtemp(join(tmpdir(), "scratchpad-arm64-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const binaries = {};
  const roles = platform === "linux" ? ["built", "deb", "appimage"] : ["built", "msi", "nsis"];
  for (const role of roles) {
    binaries[role] = join(dir, role);
    await writeFile(binaries[role], platform === "linux" ? elf() : pe());
  }
  const names = platform === "linux" ? ["test.AppImage", "test.deb"] : ["test-setup.exe", "test.msi"];
  const packages = names.map(name => join(dir, name));
  for (const file of packages) await writeFile(file, "unsigned test package");
  const host = platform === "linux" ? "aarch64-unknown-linux-gnu" : "aarch64-pc-windows-msvc";
  return { platform, binaries, packages, outputDir: join(dir, "artifacts"), commit: "a".repeat(40),
    prHeadCommit: "b".repeat(40), eventName: "pull_request",
    rustc: parseRustToolchain(`rustc 1.98.0 (test build)\nhost: ${host}\nrelease: 1.98.0\n`),
    runId: "123", runAttempt: "1", version: "1.0.0" };
}

for (const platform of ["linux", "windows"]) {
  test(`${platform} evidence covers both packages and all three inspected applications`, async t => {
    const input = await fixture(t, platform);
    const report = await verifyArm64Build(input);
    assert.equal(report.purpose, "unsigned-build-feasibility");
    assert.equal(report.applicationIdentifier, "io.github.crims0n.scratchpad.dev");
    assert.equal(report.commit, input.commit);
    assert.equal(report.prHeadCommit, input.prHeadCommit);
    assert.notEqual(report.commit, report.prHeadCommit);
    assert.deepEqual(report.rustc, input.rustc);
    assert.equal(report.binaries.length, 3);
    assert.equal(report.packages.length, 2);
    assert.ok(report.binaries.every(file => /^[a-f0-9]{64}$/.test(file.sha256)));
    assert.deepEqual(JSON.parse(await readFile(join(input.outputDir, "architecture-evidence.json"))), report);
    for (const file of report.packages) {
      assert.equal((await readFile(join(input.outputDir, file.name), "utf8")), "unsigned test package");
    }
  });

  test(`${platform} rejects missing formats, payloads, identity and wrong-architecture packaged applications`, async t => {
    const input = await fixture(t, platform);
    for (const override of [{ packages: input.packages.slice(0, 1) }, { binaries: { built: input.binaries.built } },
      { commit: "main" }, { runId: "" }, { runAttempt: "0" }, { prHeadCommit: null },
      { prHeadCommit: "not-a-commit" }, { rustc: undefined }, { rustc: { ...input.rustc, host: "x86_64-unknown-linux-gnu" } }]) {
      await assert.rejects(verifyArm64Build({ ...input, ...override }));
    }
    const role = platform === "linux" ? "appimage" : "nsis";
    await writeFile(input.binaries[role], platform === "linux" ? elf(62) : pe(0x8664));
    await assert.rejects(verifyArm64Build(input), new RegExp(role));
  });
}

test("evidence refuses to mix packages into an existing artifact directory", async t => {
  const input = await fixture(t, "linux");
  await mkdir(input.outputDir);
  await assert.rejects(verifyArm64Build(input), /EEXIST/);
});

test("packaging may change binary bytes while retaining ARM64 architecture", async t => {
  const input = await fixture(t, "linux");
  const packaged = elf();
  packaged[119] = 1;
  await writeFile(input.binaries.appimage, packaged);
  const report = await verifyArm64Build(input);
  assert.notEqual(report.binaries.find(file => file.role === "built").sha256,
    report.binaries.find(file => file.role === "appimage").sha256);
});

test("manual dispatch evidence has a checkout commit and no invented PR head", async t => {
  const input = await fixture(t, "linux");
  await assert.rejects(verifyArm64Build({ ...input, eventName: "workflow_dispatch" }), /manual dispatch/);
  const report = await verifyArm64Build({ ...input, eventName: "workflow_dispatch", prHeadCommit: null });
  assert.equal(report.eventName, "workflow_dispatch");
  assert.equal(report.prHeadCommit, null);
  assert.equal(report.commit, input.commit);
});

test("application inspection reads bounded headers while hashing the complete binary", async t => {
  const input = await fixture(t, "linux");
  await truncate(input.binaries.built, 8 * 1024 * 1024);
  const header = await readApplicationHeader(input.binaries.built, "linux");
  assert.equal(header.length, 64);
  const report = await verifyArm64Build(input);
  assert.equal(report.binaries.find(file => file.role === "built").size, 8 * 1024 * 1024);
  assert.notEqual(report.binaries.find(file => file.role === "built").sha256,
    report.binaries.find(file => file.role === "deb").sha256);
});

test("file inspection rejects oversized PE offsets and reads the PIE program table", async t => {
  const input = await fixture(t, "linux");
  await writeFile(input.binaries.built, elf(183, 3));
  assert.doesNotThrow(() => assertArm64Binary(elf(183, 3), "linux"));
  assert.equal((await readApplicationHeader(input.binaries.built, "linux")).length, 120);
  const bad = pe();
  bad.writeUInt32LE(0xffffffff, 0x3c);
  await writeFile(input.binaries.built, bad);
  await assert.rejects(readApplicationHeader(input.binaries.built, "windows"), /inspection limit/);
});

async function signingFixture(t, platform) {
  const input = { ...await fixture(t, platform), eventName: "workflow_dispatch", prHeadCommit: null, sourceRef: "refs/heads/main" };
  const signingFiles = [];
  if (platform === "linux") {
    for (const name of ["SHA256SUMS", "SHA256SUMS.asc"]) {
      const file = join(dirname(input.outputDir), name);
      await writeFile(file, `signed fixture ${name}`);
      signingFiles.push(file);
    }
  }
  const assets = await Promise.all([...input.packages, ...signingFiles].map(hashFile));
  const payloads = platform === "windows" ? await Promise.all(["msi", "nsis"].map(async role => ({
    ...await hashFile(input.binaries[role]), package: basename(input.packages.find(file => file.endsWith(role === "msi" ? ".msi" : "-setup.exe"))),
    architecture: "arm64", publisher: "Patrick McDowell", certificateThumbprint: "A".repeat(40), timestampCertificateThumbprint: "B".repeat(40)
  }))) : [];
  return { ...input, signingFiles, signing: { schemaVersion: 1, platform, commit: input.commit,
    runId: input.runId, runAttempt: input.runAttempt, method: platform === "linux" ? "gpg" : "authenticode",
    ...(platform === "linux" ? { fingerprint: "A".repeat(40) } : { publisher: "Patrick McDowell", payloads }), assets } };
}

test("Windows payload evidence rejects missing timestamps and changed extracted application bytes", async t => {
  const input = await signingFixture(t, "windows");
  const payloads = input.signing.payloads.map(file => ({ ...file, timestampCertificateThumbprint: "" }));
  await assert.rejects(verifyArm64Build({ ...input, signing: { ...input.signing, payloads } }), /payload evidence/);
  const changed = pe();
  changed[127] = 1;
  await writeFile(input.binaries.nsis, changed);
  await assert.rejects(verifyArm64Build(input), /payload evidence/);
});

for (const platform of ["linux", "windows"]) {
  test(`${platform} signing evidence binds checked package bytes to a main dispatch`, async t => {
    const input = await signingFixture(t, platform);
    for (const override of [{ sourceRef: "refs/heads/feature" },
      { signing: { ...input.signing, runId: "999" } }, { signing: { ...input.signing, commit: "c".repeat(40) } },
      { signing: { ...input.signing, assets: input.signing.assets.slice(1) } },
      { signing: { ...input.signing, method: "unverified" } }]) {
      await assert.rejects(verifyArm64Build({ ...input, ...override }));
    }
    const report = await verifyArm64Build(input);
    assert.equal(report.purpose, "signing-validation");
    assert.deepEqual(report.signing, input.signing);
    for (const file of input.signingFiles) assert.ok((await readFile(join(input.outputDir, basename(file)))).length);
  });

  test(`${platform} changed packages cannot reuse signing evidence`, async t => {
    const input = await signingFixture(t, platform);
    await writeFile(input.packages[0], "bytes changed after signature checks");
    await assert.rejects(verifyArm64Build(input), /Signing evidence does not match/);
  });
}
