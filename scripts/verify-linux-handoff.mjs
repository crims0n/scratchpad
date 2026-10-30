// SPDX-License-Identifier: GPL-3.0-or-later

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { hashFile, platformAssetNames, readVerificationEvidence, verifyEvidence } from "./release-verification.mjs";

// Before importing a signing key, bind the aggregate input to both native
// build jobs' signature/payload-checked bytes from this same candidate/run.
const targets = ["x64", "arm64"].map(architecture => ({ platform: "linux", architecture }));
const directory = process.env.RELEASE_ASSETS_DIR;
const version = process.env.RELEASE_VERSION;
const names = targets.flatMap(target => platformAssetNames(version, target.platform, target.architecture)).sort();
if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(names)) {
  throw new Error("Linux aggregation requires exactly four architecture-specific packages");
}
verifyEvidence({ targets, evidence: await readVerificationEvidence(process.env.VERIFICATION_EVIDENCE_DIR, targets),
  verified: await Promise.all(names.map(name => hashFile(join(directory, name)))),
  releaseId: Number(process.env.RELEASE_ID), version, commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID });
console.log("Verified both native Linux build handoffs before aggregate signing");
