// SPDX-License-Identifier: GPL-3.0-or-later

import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { recordLinuxSigningValidation } from "./release-verification.mjs";

async function main() {
  const [architecture, fingerprint, ...files] = process.argv.slice(2);
  const output = process.env.SIGNING_VALIDATION_EVIDENCE_PATH;
  if (!output) throw new Error("SIGNING_VALIDATION_EVIDENCE_PATH must be set");
  const report = await recordLinuxSigningValidation({ architecture, fingerprint, files,
    commit: execFileSync("git", ["-C", fileURLToPath(new URL("../", import.meta.url)), "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
