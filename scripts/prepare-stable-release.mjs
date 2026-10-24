// SPDX-License-Identifier: GPL-3.0-or-later

import { execFileSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { assertMainBranch, assertReleaseAvailable, stableRelease } from "./check-stable-release.mjs";

export async function prepareDraft({ ref, repository, version, commit, body, api }) {
  assertMainBranch(ref);
  const release = stableRelease(version);
  if (!repository || !/^[a-f0-9]{40}$/.test(commit || "") || typeof body !== "string" || !body.trim()) {
    throw new Error("Repository, source commit, and release notes are required");
  }
  // This runs once, with contents: write so the list includes drafts. API
  // failures stop preparation; they never mean that a version is available.
  const refs = await api([`repos/${repository}/git/matching-refs/tags/${release.tag}`]);
  const pages = await api(["--paginate", "--slurp", `repos/${repository}/releases?per_page=100`]);
  if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page))) throw new Error("Invalid GitHub release pagination response");
  assertReleaseAvailable(release.tag, refs, pages.flat());
  const draft = await api([`repos/${repository}/releases`], {
    tag_name: release.tag,
    name: `Scratchpad v${release.version}`,
    body,
    draft: true,
    prerelease: false,
    target_commitish: commit,
    generate_release_notes: true
  });
  if (!Number.isSafeInteger(draft?.id) || draft.id <= 0 || draft.tag_name !== release.tag
    || draft.name !== `Scratchpad v${release.version}` || draft.target_commitish !== commit
    || draft.draft !== true || draft.prerelease !== false) {
    throw new Error("GitHub did not return the expected candidate draft; inspect releases before retrying");
  }
  return { ...release, releaseId: draft.id };
}

async function main() {
  const config = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  const api = (args, body) => JSON.parse(execFileSync("gh", ["api", ...args, ...(body ? ["--method", "POST", "--input", "-"] : [])], {
    input: body ? JSON.stringify(body) : undefined,
    encoding: "utf8", stdio: ["pipe", "pipe", "inherit"]
  }));
  const result = await prepareDraft({ ref: process.env.GITHUB_REF, repository: process.env.GITHUB_REPOSITORY,
    version: config.version, commit: process.env.GITHUB_SHA, body: process.env.RELEASE_BODY, api });
  process.stdout.write(`release_id=${result.releaseId}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Prepared candidate ${result.tag}\n\nRelease ID: ${result.releaseId}. Source: \`${process.env.GITHUB_SHA}\`. This empty draft is awaiting signed builds and final verification; it is not ready to publish.\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
