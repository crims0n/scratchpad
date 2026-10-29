// SPDX-License-Identifier: GPL-3.0-or-later

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertArm64Binary, verifyArm64Build } from "../scripts/verify-arm64-build.mjs";

function elf(machine = 183) {
  const bytes = Buffer.alloc(64);
  bytes.write("\x7fELF");
  bytes[4] = 2;
  bytes[5] = 1;
  bytes.writeUInt16LE(machine, 18);
  return bytes;
}

function pe(machine = 0xaa64) {
  const bytes = Buffer.alloc(128);
  bytes.write("MZ");
  bytes.writeUInt32LE(64, 0x3c);
  bytes.writeUInt32LE(0x4550, 64);
  bytes.writeUInt16LE(machine, 68);
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
  return { platform, binaries, packages, outputDir: join(dir, "artifacts"), commit: "a".repeat(40),
    runId: "123", runAttempt: "1", version: "1.0.0" };
}

for (const platform of ["linux", "windows"]) {
  test(`${platform} evidence covers both packages and all three inspected applications`, async t => {
    const input = await fixture(t, platform);
    const report = await verifyArm64Build(input);
    assert.equal(report.purpose, "unsigned-build-feasibility");
    assert.equal(report.applicationIdentifier, "io.github.crims0n.scratchpad.dev");
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
      { commit: "main" }, { runId: "" }, { runAttempt: "0" }]) {
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
  packaged[63] = 1;
  await writeFile(input.binaries.appimage, packaged);
  const report = await verifyArm64Build(input);
  assert.notEqual(report.binaries.find(file => file.role === "built").sha256,
    report.binaries.find(file => file.role === "appimage").sha256);
});
