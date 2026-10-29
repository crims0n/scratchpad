// SPDX-License-Identifier: GPL-3.0-or-later

import { appendFile, readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

export const RELEASE_FEED = "https://crims0n.github.io/scratchpad/release.json";
const MAX_BYTES = 1024 * 1024;
const RECOVERY = "Inspect the generated artifact and live feed, then use Actions → Deploy website → Run workflow on main if Pages served stale content. See docs/release-checklist.md#recover-a-stale-website-deployment.";

// A new deployment can legitimately generate the same release catalog at a
// different time. Everything else, including notes, aliases and every asset
// field, must match the artifact rather than a version-only success check.
function releaseContent(manifest) {
  const { generatedAt, ...content } = manifest;
  return content;
}

export function assertLiveManifest(expected, live) {
  if (!live || !isDeepStrictEqual(releaseContent(expected), releaseContent(live))) {
    const section = !isDeepStrictEqual(expected.channels, live?.channels) ? "stable/legacy metadata"
      : !isDeepStrictEqual(expected.release.assets, live?.release?.assets) ? "installer catalog, URLs, sizes or hashes"
        : "release metadata or manifest schema";
    throw new Error(`Live release feed differs from the generated artifact: ${section} (expected ${expected.release.tag}; received ${live?.release?.tag || "invalid manifest"})`);
  }
}

export async function fetchLiveManifest({ fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const response = await fetchImpl(RELEASE_FEED, {
    redirect: "error",
    cache: "no-store",
    headers: { accept: "application/json", "cache-control": "no-cache" },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Public release feed returned HTTP ${response.status}`);
  }
  if (Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error("Public release feed exceeds 1 MiB");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > MAX_BYTES) throw new Error("Public release feed exceeds 1 MiB");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function verifyPagesRelease(expected, {
  fetchImpl = fetch,
  now = () => performance.now(),
  wait = sleep,
  maxWaitMs = 12 * 60_000,
  retryDelayMs = 15_000,
  requestTimeoutMs = 10_000,
  log = console.log
} = {}) {
  if (expected?.schemaVersion !== 1 || expected.repository !== "crims0n/scratchpad"
    || !expected.release?.tag || !Array.isArray(expected.release.assets)
    || expected.release.assets.length === 0
    || expected.release.assets.some(asset => !/^[a-f0-9]{64}$/i.test(asset?.sha256 || "")
      || !Number.isSafeInteger(asset.size) || asset.size <= 0)
    || !expected.channels || !Number.isFinite(maxWaitMs) || maxWaitMs <= 0
    || !Number.isFinite(retryDelayMs) || retryDelayMs <= 0
    || !Number.isInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error("Expected a generated Scratchpad release manifest and positive verification time limits");
  }
  const deadline = now() + maxWaitMs;
  let attempt = 0;
  let lastError;
  while (now() < deadline) {
    attempt++;
    try {
      const timeoutMs = Math.max(1, Math.ceil(Math.min(requestTimeoutMs, deadline - now())));
      const live = await fetchLiveManifest({ fetchImpl, timeoutMs });
      assertLiveManifest(expected, live);
      // A response arriving after the overall deadline is not an on-time pass.
      if (now() >= deadline) throw new Error("Verification deadline elapsed during the request");
      log(`Verified canonical public release feed: ${expected.release.tag} (${expected.release.assets.length} installers), attempt ${attempt}`);
      return { tag: expected.release.tag, attempts: attempt };
    } catch (error) {
      lastError = error;
      log(`Public release verification attempt ${attempt}: ${error.message}`);
    }
    const remaining = deadline - now();
    if (remaining > 0) await wait(Math.min(retryDelayMs, remaining));
  }
  throw new Error(`Public release verification timed out after ${maxWaitMs / 1000}s. Last check: ${lastError?.message || "no response"}. ${RECOVERY}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--expected") {
    throw new Error("Usage: verify-pages-release.mjs --expected <generated-release.json>");
  }
  const expected = JSON.parse(await readFile(args[1], "utf8"));
  try {
    const result = await verifyPagesRelease(expected);
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY,
        `## Verified live website release\n\nCanonical release.json matches the generated artifact for ${result.tag}: release metadata, stable/legacy aliases, and all installer URLs, sizes and hashes. Verification took ${result.attempts} attempt(s).\n`);
    }
  } catch (error) {
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY,
        `## Live website verification failed\n\nThe canonical release.json was not verified against the generated artifact. See the failed check's diagnostic above. A successful deploy-pages result alone is insufficient. ${RECOVERY}\n`);
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
