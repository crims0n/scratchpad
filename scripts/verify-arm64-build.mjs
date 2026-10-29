// SPDX-License-Identifier: GPL-3.0-or-later

import { execFileSync } from "node:child_process";
import { copyFile, mkdir, open, readFile, writeFile, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { hashFile, validFileMetadata } from "./release-verification.mjs";

const targets = { linux: "aarch64-unknown-linux-gnu", windows: "aarch64-pc-windows-msvc" };
const maxHeaderBytes = 1024 * 1024;

function elfProgramHeadersEnd(bytes) {
  const offset = bytes.readBigUInt64LE(32);
  const size = bytes.readUInt16LE(54);
  const count = bytes.readUInt16LE(56);
  const end = offset + BigInt(size) * BigInt(count);
  if (offset < 64n || size < 56 || !count || end > BigInt(maxHeaderBytes)) {
    throw new Error("Invalid or oversized ELF program header table");
  }
  return Number(end);
}

export function assertArm64Binary(bytes, platform) {
  if (platform === "linux") {
    if (bytes.length < 64 || bytes.subarray(0, 4).toString("hex") !== "7f454c46"
      || bytes[4] !== 2 || bytes[5] !== 1 || bytes.readUInt16LE(18) !== 183) {
      throw new Error("Expected a little-endian ARM64 ELF64 application");
    }
    const type = bytes.readUInt16LE(16);
    if (![2, 3].includes(type) || bytes.readBigUInt64LE(24) === 0n) {
      throw new Error("Expected an ELF executable with an entry point");
    }
    // PIE applications are ET_DYN too. Require their interpreter header so
    // ordinary ARM64 shared libraries are not classified as applications.
    if (type === 3) {
      const end = elfProgramHeadersEnd(bytes);
      if (bytes.length < end) throw new Error("Truncated ELF program header table");
      const offset = Number(bytes.readBigUInt64LE(32));
      const size = bytes.readUInt16LE(54);
      let interpreter = false;
      for (let index = offset; index < end; index += size) {
        if (bytes.readUInt32LE(index) === 3) interpreter = true;
      }
      if (!interpreter) throw new Error("Expected a PIE application with an interpreter header");
    }
  } else if (platform === "windows") {
    if (bytes.length < 64 || bytes.subarray(0, 2).toString() !== "MZ") throw new Error("Expected an ARM64 PE32+ application");
    const offset = bytes.readUInt32LE(0x3c);
    if (offset < 64 || offset + 26 > bytes.length || bytes.readUInt32LE(offset) !== 0x4550
      || bytes.readUInt16LE(offset + 4) !== 0xaa64 || bytes.readUInt16LE(offset + 24) !== 0x20b) {
      throw new Error("Expected an ARM64 PE32+ application");
    }
    const flags = bytes.readUInt16LE(offset + 22);
    if (!(flags & 0x0002) || (flags & 0x2000)) throw new Error("Expected a PE executable image, not an object or DLL");
  } else {
    throw new Error("Unknown feasibility platform");
  }
}

async function readPrefix(handle, length) {
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(bytes, offset, length - offset, offset);
    if (!bytesRead) break;
    offset += bytesRead;
  }
  return bytes.subarray(0, offset);
}

export async function readApplicationHeader(file, platform) {
  const handle = await open(file, "r");
  try {
    const initial = await readPrefix(handle, 64);
    if (initial.length < 64) return initial;
    let end = 64;
    if (platform === "linux" && initial.subarray(0, 6).toString("hex") === "7f454c460201"
      && initial.readUInt16LE(16) === 3) end = elfProgramHeadersEnd(initial);
    if (platform === "windows" && initial.subarray(0, 2).toString() === "MZ") end = initial.readUInt32LE(0x3c) + 26;
    if (end > maxHeaderBytes) throw new Error("Application header exceeds inspection limit");
    return end <= 64 ? initial : await readPrefix(handle, end);
  } finally {
    await handle.close();
  }
}

export function parseRustToolchain(details) {
  details = details.replace(/\r\n/g, "\n");
  const version = /^release: (\S+)$/m.exec(details)?.[1];
  const host = /^host: (\S+)$/m.exec(details)?.[1];
  if (!version || !host) throw new Error("Rust toolchain version and host are required");
  return { version, host, details: details.trim() };
}

export async function verifyArm64Build({ platform, packages, binaries, outputDir, commit, prHeadCommit,
  eventName, rustc, runId, runAttempt, version, signing = null, signingFiles = [], sourceRef }) {
  const roles = platform === "linux" ? ["built", "deb", "appimage"] : ["built", "msi", "nsis"];
  if (!targets[platform] || JSON.stringify(Object.keys(binaries).sort()) !== JSON.stringify(roles.sort())) {
    throw new Error("Expected the built application and both extracted package payloads");
  }
  const extensions = platform === "linux" ? [".AppImage", ".deb"] : ["-setup.exe", ".msi"];
  if (!Array.isArray(packages) || packages.length !== 2
    || extensions.some(extension => packages.filter(file => file.endsWith(extension)).length !== 1)) {
    throw new Error("Expected exactly two distinct package formats");
  }
  if (!/^[a-f0-9]{40}$/.test(commit || "") || !/^[1-9]\d*$/.test(runId || "")
    || !/^[1-9]\d*$/.test(runAttempt || "") || !/^\d+\.\d+\.\d+$/.test(version || "")) {
    throw new Error("Expected source commit, workflow run/attempt and package version");
  }
  if (!["pull_request", "workflow_dispatch"].includes(eventName)
    || (eventName === "pull_request" && !/^[a-f0-9]{40}$/.test(prHeadCommit || ""))
    || (eventName === "workflow_dispatch" && prHeadCommit !== null)) {
    throw new Error("Expected PR head provenance, or an explicit manual dispatch without a PR head");
  }
  if (!rustc?.version || !rustc.details || rustc.host !== targets[platform]) {
    throw new Error("Expected recorded native ARM64 Rust toolchain version and host");
  }
  const binaryRecords = [];
  for (const [role, file] of Object.entries(binaries)) {
    const bytes = await readApplicationHeader(file, platform);
    try { assertArm64Binary(bytes, platform); }
    catch (error) { throw new Error(`${role}: ${error.message}`, { cause: error }); }
    binaryRecords.push({ role, ...await hashFile(file) });
  }
  // Packaging can strip symbols or change ELF runtime paths. Record each
  // inspected payload's actual hash rather than assuming identical bytes.
  const packageRecords = await Promise.all(packages.map(hashFile));
  const extraRecords = await Promise.all(signingFiles.map(hashFile));
  if (signing) {
    if (eventName !== "workflow_dispatch" || sourceRef !== "refs/heads/main"
      || signing.schemaVersion !== 1 || signing.platform !== platform || signing.commit !== commit
      || signing.runId !== runId || signing.runAttempt !== runAttempt) {
      throw new Error("Signing validation requires matching protected main dispatch provenance");
    }
    if ((platform === "windows" && (signing.method !== "authenticode" || signing.publisher !== "Patrick McDowell"))
      || (platform === "linux" && (signing.method !== "gpg" || !/^[A-F0-9]{40}$/.test(signing.fingerprint || "")))) {
      throw new Error("Expected platform signing verification evidence");
    }
    if (platform === "windows") {
      if (!Array.isArray(signing.payloads) || binaryRecords.filter(file => file.role !== "built").some(binary => {
        const packageName = packageRecords.find(file => file.name.endsWith(binary.role === "msi" ? ".msi" : "-setup.exe")).name;
        return !signing.payloads.some(payload => payload.package === packageName && payload.name === binary.name
          && payload.sha256 === binary.sha256 && payload.size === binary.size && payload.architecture === "arm64"
          && payload.publisher === signing.publisher && /^[a-f0-9]{40}$/i.test(payload.certificateThumbprint || "")
          && /^[a-f0-9]{40}$/i.test(payload.timestampCertificateThumbprint || ""));
      })) throw new Error("Windows application bytes do not match signature-checked payload evidence");
    }
    const expectedExtras = platform === "linux" ? ["SHA256SUMS", "SHA256SUMS.asc"] : [];
    if (JSON.stringify(extraRecords.map(file => file.name).sort()) !== JSON.stringify(expectedExtras)) {
      throw new Error("Signing validation must include the platform checksum/signature files exactly");
    }
    const files = [...packageRecords, ...extraRecords];
    if (!Array.isArray(signing.assets) || signing.assets.length !== files.length
      || new Set(signing.assets.map(file => file.name)).size !== files.length
      || files.some(file => !signing.assets.some(asset => validFileMetadata(asset)
        && asset.name === file.name && asset.size === file.size && asset.sha256 === file.sha256))) {
      throw new Error("Signing evidence does not match the inspected package bytes");
    }
  } else if (signingFiles.length) {
    throw new Error("Checksum files require signing verification evidence");
  }
  const report = { schemaVersion: 1, purpose: signing ? "signing-validation" : "unsigned-build-feasibility", platform, architecture: "arm64",
    target: targets[platform], commit, prHeadCommit, eventName, rustc, runId, runAttempt, version,
    applicationIdentifier: "io.github.crims0n.scratchpad.dev",
    packages: packageRecords, binaries: binaryRecords, ...(signing ? { signing } : {}) };
  await mkdir(outputDir);
  const copiedRecords = [...packageRecords, ...extraRecords];
  for (const [index, file] of [...packages, ...signingFiles].entries()) {
    const destination = join(outputDir, copiedRecords[index].name);
    await copyFile(file, destination);
    const copied = await hashFile(destination);
    if (copied.sha256 !== copiedRecords[index].sha256 || copied.size !== copiedRecords[index].size) {
      throw new Error("Artifact copy differs from the inspected package");
    }
  }
  await writeFile(join(outputDir, "architecture-evidence.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  return report;
}

async function main() {
  const options = Object.fromEntries(["platform", "built", "deb", "appimage", "msi", "nsis", "output-dir", "signing-evidence"].map(name => [name, { type: "string" }]));
  options.package = { type: "string", multiple: true };
  const { values } = parseArgs({ options });
  if (process.arch !== "arm64" || process.platform !== (values.platform === "windows" ? "win32" : "linux")) {
    throw new Error("Feasibility verification must run on the matching native ARM64 host");
  }
  const signing = values["signing-evidence"] ? JSON.parse((await readFile(values["signing-evidence"], "utf8")).replace(/^\uFEFF/, "")) : null;
  const signingFiles = signing && values.platform === "linux"
    ? ["SHA256SUMS", "SHA256SUMS.asc"].map(name => join(dirname(values["signing-evidence"]), name)) : [];
  const report = await verifyArm64Build({ platform: values.platform, packages: values.package, signing, signingFiles,
    sourceRef: process.env.GITHUB_REF,
    binaries: Object.fromEntries(["built", "deb", "appimage", "msi", "nsis"].filter(role => values[role]).map(role => [role, values[role]])),
    outputDir: values["output-dir"], commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    prHeadCommit: process.env.PR_HEAD_COMMIT || null, eventName: process.env.GITHUB_EVENT_NAME,
    rustc: parseRustToolchain(execFileSync("rustc", ["-vV"], { encoding: "utf8" })), runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT, version: JSON.parse(await readFile("package.json", "utf8")).version });
  const signingStatus = signing ? `Signing validation: ${signing.method}; signature-checked package hashes match this run's evidence.` : "Signing has not been established.";
  const summary = `## ${signing ? "Signed" : "Unsigned"} ${report.platform} ARM64 development package validation\n\nChecked-out source: \`${report.commit}\`. PR head: ${report.prHeadCommit ? `\`${report.prHeadCommit}\`` : "not applicable (manual dispatch)"}. Rust ${report.rustc.version}, host \`${report.rustc.host}\`. Native ARM64 host; the compiled application and both extracted package applications have ARM64 executable headers. Development identity only. ${signingStatus} GUI launch, MCP and upgrade acceptance have not been established. Artifacts expire after seven days.\n\n| Package | SHA-256 |\n| --- | --- |\n${report.packages.map(file => `| ${file.name} | \`${file.sha256}\` |`).join("\n")}\n`;
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
