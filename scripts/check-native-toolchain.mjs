// SPDX-License-Identifier: GPL-3.0-or-later

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseRustToolchain } from "./verify-arm64-build.mjs";

export function assertNativeToolchain({ architecture, target, nodeArchitecture, rustDetails }) {
  if (!["x64", "arm64"].includes(architecture) || nodeArchitecture !== architecture) {
    throw new Error(`Expected native ${architecture} Node.js, got ${nodeArchitecture}`);
  }
  const rust = parseRustToolchain(rustDetails);
  if (rust.host !== target) throw new Error(`Expected native Rust host ${target}, got ${rust.host}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [architecture, target] = process.argv.slice(2);
  assertNativeToolchain({ architecture, target, nodeArchitecture: process.arch,
    rustDetails: execFileSync("rustc", ["-vV"], { encoding: "utf8" }) });
  console.log(`Verified native ${architecture} Node.js and Rust ${target}`);
}
