// SPDX-License-Identifier: GPL-3.0-or-later

import { appendFile, readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import { assertReleaseRepository, validFileMetadata } from "./release-verification.mjs";

const MAX_BYTES = 1024 * 1024;
const RECOVERY = "Inspect the generated artifact and live feed, then use Actions → Deploy website → Run workflow on main if Pages served stale content. See docs/release-checklist.md#recover-a-stale-website-deployment.";

// A new deployment can legitimately generate the same release catalog at a
// different time. Everything else, including notes, aliases and every asset
// field, must match the artifact rather than a version-only success check.
function releaseContent(manifest) {
  const { generatedAt, ...content } = manifest;
  return content;
}

export function releaseFeedUrl(siteUrl) {
  const base = new URL(siteUrl);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
    throw new Error("Expected an HTTPS Pages site URL without credentials, query or fragment");
  }
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  // Check the URL clients actually use. A cache-busted URL could look current
  // while the canonical feed continues to advertise an older release.
  return new URL("release.json", base).href;
}

function firstDifference(expected, live, path = "manifest", asset) {
  if (isDeepStrictEqual(expected, live)) return null;
  if (expected && live && typeof expected === "object" && typeof live === "object"
    && Array.isArray(expected) === Array.isArray(live)) {
    if (Array.isArray(expected) && expected.length !== live.length) return { path: `${path}.length`, asset };
    for (const key of new Set([...Object.keys(expected), ...Object.keys(live)])) {
      const next = Array.isArray(expected) ? `${path}[${key}]` : `${path}.${key}`;
      const name = path.endsWith(".assets") ? expected[key]?.name : asset;
      if (!Object.hasOwn(expected, key) || !Object.hasOwn(live, key)) return { path: next, asset: name };
      const difference = firstDifference(expected[key], live[key], next, name);
      if (difference) return difference;
    }
  }
  return { path, asset };
}

export function assertLiveManifest(expected, live) {
  if (!live || !isDeepStrictEqual(releaseContent(expected), releaseContent(live))) {
    const difference = firstDifference(releaseContent(expected), live && releaseContent(live));
    const asset = difference.asset ? `, asset ${JSON.stringify(difference.asset)}` : "";
    throw new Error(`Live release feed differs from the generated artifact at ${difference.path}${asset} (expected ${expected.release.tag}; received ${live?.release?.tag || "invalid manifest"})`);
  }
}

export async function fetchLiveManifest({ feedUrl, fetchImpl = fetch, timeoutMs = 10_000 }) {
  const response = await fetchImpl(feedUrl, {
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
  if (!response.body) throw new Error(`Public release feed is empty (HTTP ${response.status})`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > MAX_BYTES) throw new Error("Public release feed exceeds 1 MiB");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) throw new Error(`Public release feed is empty (HTTP ${response.status})`);
  return JSON.parse(text);
}

export async function verifyPagesRelease(expected, {
  siteUrl,
  repository,
  fetchImpl = fetch,
  now = () => performance.now(),
  wait = sleep,
  maxWaitMs = 12 * 60_000,
  retryDelayMs = 15_000,
  requestTimeoutMs = 10_000,
  log = console.log
} = {}) {
  assertReleaseRepository(repository);
  const feedUrl = releaseFeedUrl(siteUrl);
  if (expected?.schemaVersion !== 1 || expected.repository !== repository
    || !expected.release?.tag || !Array.isArray(expected.release.assets)
    || expected.release.assets.length === 0
    || !expected.release.assets.every(validFileMetadata)
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
      const live = await fetchLiveManifest({ feedUrl, fetchImpl, timeoutMs });
      assertLiveManifest(expected, live);
      // A response arriving after the overall deadline is not an on-time pass.
      if (now() >= deadline) throw new Error("Verification deadline elapsed during the request");
      log(`Verified canonical public release feed: ${expected.release.tag} (${expected.release.assets.length} installers), attempt ${attempt}; ${feedUrl}`);
      return { tag: expected.release.tag, attempts: attempt, feedUrl };
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
  try {
    const args = process.argv.slice(2);
    const options = new Map();
    for (let i = 0; i < args.length; i += 2) {
      if (!["--expected", "--site-url", "--repository"].includes(args[i]) || !args[i + 1] || options.has(args[i])) {
        throw new Error("Usage: verify-pages-release.mjs --expected <generated-release.json> --site-url <Pages URL> --repository <owner/repo>");
      }
      options.set(args[i], args[i + 1]);
    }
    if (options.size !== 3) throw new Error("Expected --expected, --site-url and --repository arguments");
    const expected = JSON.parse(await readFile(options.get("--expected"), "utf8"));
    const result = await verifyPagesRelease(expected, {
      siteUrl: options.get("--site-url"), repository: options.get("--repository")
    });
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY,
        `## Verified live website release\n\nCanonical feed: ${result.feedUrl}\n\nRepository: ${expected.repository}. The feed matches the generated artifact for ${result.tag}: release metadata, stable/legacy aliases, and all installer URLs, sizes and hashes. Verification took ${result.attempts} attempt(s).\n`);
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
