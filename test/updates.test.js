// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { createUpdateChecker, readUpdatePreferences, UPDATE_PREFERENCES_KEY, UPDATE_INTERVAL_MS, UPDATE_LAUNCH_DELAY_MS } from "../src/updates.js";

const release = { version: "0.8.0", channel: "beta", notes: "New features", url: "https://github.com/crims0n/scratchpad/releases/tag/scratchpad-beta-v0.8.0" };
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

async function setup({ preferences = null, fetch = async () => release } = {}) {
  let time = 1_000_000_000;
  let nextId = 0;
  const timers = new Map();
  const data = new Map(preferences ? [[UPDATE_PREFERENCES_KEY, JSON.stringify(preferences)]] : []);
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const calls = [];
  const invoke = async (command, args) => {
    calls.push({ command, args });
    if (command === "get_update_info") return { installedVersion: "0.7.1", channel: "beta" };
    if (command === "check_for_updates") return fetch();
  };
  const checker = createUpdateChecker({ invoke, storage, now: () => time,
    setTimer: (callback, delay) => { timers.set(++nextId, { callback, at: time + delay }); return nextId; },
    clearTimer: (id) => timers.delete(id)
  });
  await checker.ready;
  return { checker, storage, calls, timers,
    count: () => calls.filter((call) => call.command === "check_for_updates").length,
    advance: async (ms) => {
      time += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.callback(); }
      await flush();
    }
  };
}

test("checks are opt-in, delayed, daily, and persisted across launches", async () => {
  const app = await setup();
  assert.equal(app.timers.size, 0);
  assert.equal(app.count(), 0);
  app.checker.setAutomatic(true);
  await app.advance(UPDATE_LAUNCH_DELAY_MS - 1);
  assert.equal(app.count(), 0);
  await app.advance(1);
  assert.equal(app.count(), 1);
  assert.equal(app.checker.snapshot().indicator, true);
  const saved = readUpdatePreferences(app.storage);
  assert.equal(saved.automatic, true);
  assert.ok(saved.lastCheck);
  await app.advance(UPDATE_INTERVAL_MS - 1);
  assert.equal(app.count(), 1);
  await app.advance(1);
  assert.equal(app.count(), 2);
  app.checker.setAutomatic(false);
  await app.advance(UPDATE_INTERVAL_MS * 2);
  assert.equal(app.count(), 2);
  const restarted = await setup({ preferences: saved });
  await restarted.advance(UPDATE_LAUNCH_DELAY_MS);
  assert.equal(restarted.count(), 0);
  app.checker.dispose();
  restarted.checker.dispose();
});

test("manual checks reveal skipped releases, share in-flight work, and open the exact release", async () => {
  let resolve;
  const app = await setup({ preferences: { automatic: true, skippedVersion: release.version }, fetch: () => new Promise((done) => { resolve = done; }) });
  await app.advance(UPDATE_LAUNCH_DELAY_MS);
  const manual = app.checker.check();
  assert.equal(app.count(), 1);
  resolve(release);
  await manual;
  assert.equal(app.checker.snapshot().status, "available");
  assert.equal(app.checker.snapshot().indicator, false);
  await app.checker.openRelease();
  assert.deepEqual(app.calls.at(-1), { command: "open_update_release", args: { url: release.url } });
  app.checker.skip();
  assert.equal(app.checker.snapshot().release, null);
  assert.equal(readUpdatePreferences(app.storage).skippedVersion, release.version);
  await app.advance(UPDATE_INTERVAL_MS);
  resolve(release);
  await flush();
  assert.equal(app.checker.snapshot().status, "skipped");
  assert.equal(app.checker.snapshot().indicator, false);
  app.checker.dispose();
});

test("opt-out discards a background result and cancels subsequent checks", async () => {
  let resolve;
  const app = await setup({ preferences: { automatic: true }, fetch: () => new Promise((done) => { resolve = done; }) });
  await app.advance(UPDATE_LAUNCH_DELAY_MS);
  app.checker.setAutomatic(false);
  resolve(release);
  await flush();
  assert.equal(app.checker.snapshot().release, null);
  assert.equal(app.checker.snapshot().status, "idle");
  assert.equal(app.timers.size, 0);
  await app.advance(UPDATE_INTERVAL_MS * 2);
  assert.equal(app.count(), 1);
});

test("offline attempts are throttled, and manual retry distinguishes current from failure", async () => {
  let offline = true;
  const app = await setup({ preferences: { automatic: true }, fetch: async () => {
    if (offline) throw new Error("offline");
    return null;
  } });
  await app.advance(UPDATE_LAUNCH_DELAY_MS);
  assert.equal(app.checker.snapshot().status, "error");
  assert.equal(app.checker.snapshot().indicator, false);
  await app.advance(UPDATE_INTERVAL_MS - 1);
  assert.equal(app.count(), 1);
  offline = false;
  await app.checker.check();
  assert.equal(app.count(), 2);
  assert.equal(app.checker.snapshot().status, "current");
  app.checker.dispose();
});

test("malformed preferences default to off and failed persistence does not enable networking", async () => {
  assert.deepEqual(readUpdatePreferences({ getItem: () => "{" }), { automatic: false, lastCheck: null, skippedVersion: null });
  assert.equal(readUpdatePreferences({ getItem: () => '{"automatic":"true","lastCheck":"yesterday"}' }).automatic, false);
  const app = await setup();
  app.storage.setItem = () => { throw new Error("quota exceeded"); };
  app.checker.setAutomatic(true);
  assert.equal(app.checker.snapshot().automatic, false);
  assert.match(app.checker.snapshot().preferenceError, /could not be saved/);
  assert.equal(app.timers.size, 0);
});

test("future check timestamps cannot postpone checks indefinitely", async () => {
  const app = await setup({ preferences: { automatic: true, lastCheck: Number.MAX_SAFE_INTEGER } });
  await app.advance(UPDATE_INTERVAL_MS);
  assert.equal(app.count(), 1);
  app.checker.dispose();
});

test("opting out still stops networking if the preference cannot be saved", async () => {
  const app = await setup({ preferences: { automatic: true } });
  app.storage.setItem = () => { throw new Error("storage unavailable"); };
  app.checker.setAutomatic(false);
  assert.equal(app.checker.snapshot().automatic, false);
  assert.match(app.checker.snapshot().preferenceError, /could not be saved/);
  await app.advance(UPDATE_INTERVAL_MS * 2);
  assert.equal(app.count(), 0);
});

test("opting out during local initialization prevents the network request from starting", async () => {
  let resolveInfo;
  const info = new Promise((resolve) => { resolveInfo = resolve; });
  let checks = 0;
  const checker = createUpdateChecker({
    storage: { getItem: () => '{"automatic":true}', setItem: () => {} },
    invoke: async (command) => { if (command === "get_update_info") return info; checks++; return release; }
  });
  const pending = checker.check(false);
  checker.setAutomatic(false);
  resolveInfo({ installedVersion: "0.7.1", channel: "beta" });
  await pending;
  await checker.ready;
  assert.equal(checks, 0);
  checker.dispose();
});
