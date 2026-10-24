// SPDX-License-Identifier: GPL-3.0-or-later

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import semver from "semver";

export function stableRelease(version) {
  const parsed = semver.parse(version);
  if (!parsed || parsed.major < 1 || parsed.prerelease.length || parsed.build.length || parsed.version !== version) {
    throw new Error("Stable releases require a canonical version of 1.0.0 or later without prerelease/build suffixes");
  }
  return { version, tag: `v${version}` };
}

export function assertReleaseAvailable(tag, refs, releases) {
  if (!Array.isArray(refs) || !Array.isArray(releases)
    || refs.some(ref => typeof ref?.ref !== "string")
    || releases.some(release => typeof release?.tag_name !== "string")) {
    throw new Error("Invalid GitHub tag or release response; refusing to build");
  }
  if (refs.some(ref => ref.ref === `refs/tags/${tag}`)
    || releases.some(release => release.tag_name === tag)) {
    throw new Error(`Tag or release ${tag} already exists, including drafts. Prepare a new version or deliberately clean up a failed candidate first.`);
  }
}

async function main() {
  if (process.env.GITHUB_REF !== "refs/heads/main") throw new Error("Stable releases must run from main");
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) throw new Error("GITHUB_REPOSITORY must be set");
  const config = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  const release = stableRelease(config.version);
  const query = args => JSON.parse(execFileSync("gh", ["api", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }));
  // Do not interpret authentication/network failures as an unused version.
  const refs = query([`repos/${repository}/git/matching-refs/tags/${release.tag}`]);
  const pages = query(["--paginate", "--slurp", `repos/${repository}/releases?per_page=100`]);
  if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page))) throw new Error("Invalid GitHub release pagination response");
  assertReleaseAvailable(release.tag, refs, pages.flat());
  process.stdout.write(`version=${release.version}\ntag=${release.tag}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
