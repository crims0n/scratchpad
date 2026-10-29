// SPDX-License-Identifier: GPL-3.0-or-later

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const targets = { linux: "aarch64-unknown-linux-gnu", windows: "aarch64-pc-windows-msvc" };

export function assertArm64Binary(bytes, platform) {
  if (platform === "linux") {
    if (bytes.length < 64 || bytes.subarray(0, 4).toString("hex") !== "7f454c46"
      || bytes[4] !== 2 || bytes[5] !== 1 || bytes.readUInt16LE(18) !== 183) {
      throw new Error("Expected a little-endian ARM64 ELF64 application");
    }
  } else if (platform === "windows") {
    if (bytes.length < 64 || bytes.subarray(0, 2).toString() !== "MZ") throw new Error("Expected an ARM64 PE32+ application");
    const offset = bytes.readUInt32LE(0x3c);
    if (offset < 64 || offset + 26 > bytes.length || bytes.readUInt32LE(offset) !== 0x4550
      || bytes.readUInt16LE(offset + 4) !== 0xaa64 || bytes.readUInt16LE(offset + 24) !== 0x20b) {
      throw new Error("Expected an ARM64 PE32+ application");
    }
  } else {
    throw new Error("Unknown feasibility platform");
  }
}

function metadata(name, bytes) {
  if (!bytes.length) throw new Error(`Empty file: ${name}`);
  return { name, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function verifyArm64Build({ platform, packages, binaries, outputDir, commit, runId, runAttempt, version }) {
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
  const binaryRecords = [];
  for (const [role, file] of Object.entries(binaries)) {
    const bytes = await readFile(file);
    try { assertArm64Binary(bytes, platform); }
    catch (error) { throw new Error(`${role}: ${error.message}`, { cause: error }); }
    binaryRecords.push({ role, ...metadata(basename(file), bytes) });
  }
  // The extracted application must be the exact binary that was compiled.
  const built = binaryRecords.find(record => record.role === "built");
  if (binaryRecords.some(record => record.sha256 !== built.sha256 || record.size !== built.size)) {
    throw new Error("Packaged application does not match the built application");
  }
  const packageRecords = await Promise.all(packages.map(async file => metadata(basename(file), await readFile(file))));
  const report = { schemaVersion: 1, purpose: "unsigned-build-feasibility", platform, architecture: "arm64",
    target: targets[platform], commit, runId, runAttempt, version, applicationIdentifier: "io.github.crims0n.scratchpad.dev",
    packages: packageRecords, binaries: binaryRecords };
  await mkdir(outputDir);
  for (const [index, file] of packages.entries()) {
    const destination = join(outputDir, packageRecords[index].name);
    await copyFile(file, destination);
    if (metadata(basename(file), await readFile(destination)).sha256 !== packageRecords[index].sha256) {
      throw new Error("Artifact copy differs from the inspected package");
    }
  }
  await writeFile(join(outputDir, "architecture-evidence.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  return report;
}

async function main() {
  const options = Object.fromEntries(["platform", "built", "deb", "appimage", "msi", "nsis", "output-dir"].map(name => [name, { type: "string" }]));
  options.package = { type: "string", multiple: true };
  const { values } = parseArgs({ options });
  if (process.arch !== "arm64" || process.platform !== (values.platform === "windows" ? "win32" : "linux")) {
    throw new Error("Feasibility verification must run on the matching native ARM64 host");
  }
  const report = await verifyArm64Build({ platform: values.platform, packages: values.package,
    binaries: Object.fromEntries(["built", "deb", "appimage", "msi", "nsis"].filter(role => values[role]).map(role => [role, values[role]])),
    outputDir: values["output-dir"], commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT, version: JSON.parse(await readFile("package.json", "utf8")).version });
  const summary = `## Unsigned ${report.platform} ARM64 build feasibility\n\nSource: \`${report.commit}\`. Native ARM64 host; both package payloads match the compiled ARM64 application. Development identity only. Signing, GUI launch, MCP and upgrade acceptance have not been established. Artifacts expire after seven days.\n\n| Package | SHA-256 |\n| --- | --- |\n${report.packages.map(file => `| ${file.name} | \`${file.sha256}\` |`).join("\n")}\n`;
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
