// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { assertLiveManifest, fetchLiveManifest, RELEASE_FEED, verifyPagesRelease } from "../scripts/verify-pages-release.mjs";

const fixture = JSON.parse(await readFile(new URL("fixtures/release-transition.json", import.meta.url), "utf8"));
const expected = fixture.manifest;
const clone = () => structuredClone(expected);
const jsonResponse = value => new Response(JSON.stringify(value));

test("live verification tolerates JSON key order and generation time, not release differences", () => {
  const live = Object.fromEntries(Object.entries(clone()).reverse());
  live.generatedAt = "2026-11-01T00:00:00Z";
  assertLiveManifest(expected, live);
});

const changes = {
  "preferred release identity": m => { m.release.tag = "v0.8.2"; },
  "release version": m => { m.release.version = "1.0.1"; },
  "stable metadata": m => { m.channels.stable.prerelease = true; },
  "legacy alias version": m => { m.channels.beta.version = "0.8.2"; },
  "legacy compatibility flag": m => { m.channels.beta.prerelease = false; },
  "legacy alias URL": m => { m.channels.beta.url += "-wrong"; },
  "release notes": m => { m.release.notes = "old notes"; },
  "installer URL": m => { m.release.assets[0].url += "-wrong"; },
  "installer SHA-256": m => { m.release.assets[0].sha256 = "f".repeat(64); },
  "installer size": m => { m.release.assets[0].size++; },
  "missing installer": m => { m.release.assets.pop(); },
  "extra installer": m => { m.release.assets.push(m.release.assets[0]); },
  "repository": m => { m.repository = "someone/else"; }
};
for (const [name, change] of Object.entries(changes)) {
  test(`rejects manifest differences: ${name}`, () => {
    const live = clone();
    change(live);
    assert.throws(() => assertLiveManifest(expected, live), /differs from the generated artifact/);
  });
}

function polling(fetchImpl, overrides = {}) {
  let time = 0;
  const delays = [];
  const logs = [];
  return {
    delays, logs,
    options: {
      fetchImpl, now: () => time,
      wait: async delay => { delays.push(delay); time += delay; },
      maxWaitMs: 25, retryDelayMs: 10, log: message => logs.push(message),
      ...overrides
    },
    advance: elapsed => { time += elapsed; }
  };
}

test("retries stale content, HTTP failures and malformed JSON before accepting a matching feed", async () => {
  const stale = clone();
  stale.release.tag = "scratchpad-beta-v0.8.2";
  const responses = [jsonResponse(stale), new Response("Unavailable", { status: 503 }), new Response("<html>"), jsonResponse(expected)];
  const attempts = [];
  const p = polling(async (url, options) => {
    attempts.push({ url, options });
    return responses.shift();
  }, { maxWaitMs: 50 });
  assert.deepEqual(await verifyPagesRelease(expected, p.options), { tag: "v1.0.0", attempts: 4 });
  assert.deepEqual(p.delays, [10, 10, 10]);
  assert.ok(p.logs.some(message => /HTTP 503/.test(message)));
  for (const { url, options } of attempts) {
    assert.equal(url, RELEASE_FEED); // canonical URL, without cache-busting query
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.equal(options.headers["cache-control"], "no-cache");
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test("permanently stale content fails within the budget with actionable recovery guidance", async () => {
  let calls = 0;
  const p = polling(async () => { calls++; return jsonResponse({ release: { tag: "scratchpad-beta-v0.8.2" } }); });
  await assert.rejects(verifyPagesRelease(expected, p.options), /timed out.*expected v1.0.0.*Run workflow on main/);
  assert.equal(calls, 3);
  assert.deepEqual(p.delays, [10, 10, 5]);
});

test("failed network requests retry and eventually fail without an unbounded loop", async () => {
  const p = polling(async () => { throw new Error("network unavailable"); });
  await assert.rejects(verifyPagesRelease(expected, p.options), /timed out.*network unavailable/);
  assert.equal(p.logs.length, 3);
});

test("a matching response received after the deadline is not accepted", async () => {
  const p = polling(async () => { p.advance(30); return jsonResponse(expected); });
  await assert.rejects(verifyPagesRelease(expected, p.options), /deadline elapsed during the request/);
  assert.deepEqual(p.delays, []);
});

test("invalid expected artifacts and time budgets fail before any public request", async () => {
  const missingHash = clone();
  missingHash.release.assets[0].sha256 = null;
  const invalidSize = clone();
  invalidSize.release.assets[0].size = 0;
  const options = { fetchImpl: () => assert.fail("unexpected network request") };
  for (const manifest of [null, {}, missingHash, invalidSize]) {
    await assert.rejects(verifyPagesRelease(manifest, options), /Expected a generated/);
  }
  for (const values of [{ maxWaitMs: 0 }, { maxWaitMs: Infinity }, { retryDelayMs: 0 }, { requestTimeoutMs: -1 }]) {
    await assert.rejects(verifyPagesRelease(expected, { ...options, ...values }), /positive verification time limits/);
  }
});

test("oversized declared or streamed feed bodies are rejected", async () => {
  await assert.rejects(fetchLiveManifest({ fetchImpl: async () => new Response("{}", {
    headers: { "content-length": String(1024 * 1024 + 1) }
  }) }), /exceeds 1 MiB/);
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
    cancel() { cancelled = true; }
  });
  await assert.rejects(fetchLiveManifest({ fetchImpl: async () => new Response(body) }), /exceeds 1 MiB/);
  assert.equal(cancelled, true);
});

test("request timeout also bounds a server that stalls while streaming its response", async t => {
  let streaming = false;
  const server = createServer((_request, response) => {
    streaming = true;
    response.writeHead(200, { "content-type": "application/json" });
    response.write("{");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const endpoint = `http://127.0.0.1:${server.address().port}/release.json`;
  await assert.rejects(fetchLiveManifest({
    fetchImpl: (_canonical, options) => fetch(endpoint, options), timeoutMs: 1000
  }), error => ["AbortError", "TimeoutError"].includes(error.name));
  assert.equal(streaming, true);
});

test("release and manual-dispatch CLI paths report success or stale failure in the workflow summary", async t => {
  const dir = await mkdtemp(join(tmpdir(), "scratchpad-pages-verification-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const manifestPath = join(dir, "expected.json");
  const preload = join(dir, "fetch.mjs");
  const summary = join(dir, "summary.md");
  const script = fileURLToPath(new URL("../scripts/verify-pages-release.mjs", import.meta.url));
  await writeFile(manifestPath, JSON.stringify(expected));
  for (const event of ["release", "workflow_dispatch"]) {
    for (const stale of [false, true]) {
      await writeFile(summary, "");
      await writeFile(preload, stale
        ? `let n=0; globalThis.performance={now:()=>++n<3?n:720001}; globalThis.fetch=async()=>new Response('{}');`
        : `globalThis.fetch=async()=>new Response(${JSON.stringify(JSON.stringify(expected))});`);
      const run = promisify(execFile)(process.execPath, ["--import", pathToFileURL(preload).href, script, "--expected", manifestPath], {
        env: { ...process.env, GITHUB_EVENT_NAME: event, GITHUB_STEP_SUMMARY: summary }, timeout: 5000
      });
      if (stale) {
        await assert.rejects(run, error => error.code === 1 && /timed out.*Run workflow on main/.test(error.stderr));
        assert.match(await readFile(summary, "utf8"), /Live website verification failed/);
      } else {
        assert.match((await run).stdout, /Verified canonical public release feed: v1.0.0/);
        assert.match(await readFile(summary, "utf8"), /Verified live website release/);
      }
    }
  }
});

test("all Pages triggers share the post-deploy verifier without extra write permissions", async () => {
  const workflow = await readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
  assert.match(workflow, /release:\s+types: \[published\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /paths:[\s\S]*"scripts\/verify-pages-release.mjs"/);
  const verify = workflow.slice(workflow.indexOf("      - name: Verify canonical public release feed"));
  assert.match(verify, /timeout-minutes: 14/);
  assert.match(verify, /node scripts\/verify-pages-release.mjs --expected .pages-staging\/release.json/);
  assert.doesNotMatch(verify, /\bif:|continue-on-error/);
  assert.ok(workflow.indexOf("uses: actions/deploy-pages@") < workflow.indexOf("      - name: Verify canonical"));
  assert.doesNotMatch(workflow, /actions: write|contents: write|workflow run|deployment-branch-policies/);
});
