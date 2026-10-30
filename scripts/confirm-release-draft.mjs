// SPDX-License-Identifier: GPL-3.0-or-later

import { execFileSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { assertMainBranch } from "./check-stable-release.mjs";
import { assertDraftUnchanged, assertReleaseRepository, draftAssets } from "./release-verification.mjs";

// Called only after the read-only job has verified the downloaded files,
// platform evidence, Linux signature and website-manifest recognition.
export async function confirmVerifiedDraft({ repository, verification, releaseId, version, commit, runId, github }) {
  assertReleaseRepository(repository);
  if (verification?.schemaVersion !== 1 || !/^[1-9]\d*$/.test(runId || "") || verification.runId !== runId) {
    throw new Error("Draft confirmation requires verification from this workflow run");
  }
  const identity = { releaseId, version, commit };
  // Validate the job output before using its identity or making API calls.
  draftAssets({ ...identity, release: verification.release });
  const release = await github.release();
  const assets = assertDraftUnchanged({ ...identity, release, verifiedRelease: verification.release });
  return { releaseId, version, commit, assets };
}

async function main() {
  assertMainBranch(process.env.GITHUB_REF);
  const repository = process.env.GITHUB_REPOSITORY;
  const releaseId = Number(process.env.RELEASE_ID);
  const result = await confirmVerifiedDraft({ repository, releaseId, version: process.env.RELEASE_VERSION,
    commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
    verification: JSON.parse(process.env.VERIFIED_DRAFT || "null"), github: {
      release: () => JSON.parse(execFileSync("gh", ["api", `repos/${repository}/releases/${releaseId}`],
        { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }))
    } });
  const summary = `## Confirmed current stable draft v${result.version}\n\nChecked GitHub at ${new Date().toISOString()}. Release ID: ${result.releaseId}. Source: \`${result.commit}\`. The candidate is still an unpublished stable draft, and all twelve current asset IDs, sizes and SHA-256 digests match the downloaded snapshot verified by this workflow run. It is ready for installed-package acceptance.\n`;
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
