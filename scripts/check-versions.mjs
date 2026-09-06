// SPDX-License-Identifier: GPL-3.0-or-later

import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
const tauriConfig = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const cargoManifest = await readFile(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
const cargoLock = await readFile(new URL("../src-tauri/Cargo.lock", import.meta.url), "utf8");
const releaseNotes = await readFile(new URL("../RELEASE_NOTES.md", import.meta.url), "utf8");
const appHtml = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const cargoVersion = cargoManifest.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const aboutVersion = appHtml.match(/id="about-version">([^<]+)</)?.[1]?.trim();

const versions = new Map([
  ["package.json", packageJson.version],
  ["package-lock.json", packageLock.version],
  ["package-lock.json root package", packageLock.packages?.[""]?.version],
  ["src-tauri/tauri.conf.json", tauriConfig.version],
  ["src-tauri/Cargo.toml", cargoVersion],
  ["src-tauri/Cargo.lock", cargoLock.match(/\[\[package\]\]\nname = "scratchpad"\nversion = "([^"]+)"/)?.[1]],
  ["RELEASE_NOTES.md", releaseNotes.match(/^# Scratchpad(?: Beta)? v(\S+)/)?.[1]],
  ["src/index.html About dialog", aboutVersion]
]);

const uniqueVersions = new Set(versions.values());
if (uniqueVersions.size !== 1 || uniqueVersions.has(undefined)) {
  for (const [file, version] of versions) {
    console.error(`${file}: ${version ?? "missing"}`);
  }
  throw new Error("Application versions must match");
}

console.log(`Application version ${packageJson.version} is consistent`);
