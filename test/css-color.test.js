// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  createCssColorResolver,
  createOpaqueColorParser,
  isColorDark,
  isDarkSurface,
  parseComputedColor
} from "../src/css-color.js";
import { PRESET_THEMES } from "../src/preset-themes.js";

const dom = new JSDOM("<!doctype html><body></body>");
const resolve = createCssColorResolver(dom.window.document);
const parseOpaque = createOpaqueColorParser(resolve);
const dark = (value) => isColorDark(value, resolve);

test("computed colours are read as rgb with alpha", () => {
  assert.deepEqual(parseComputedColor("rgb(12, 34, 56)"), { rgb: [12, 34, 56], alpha: 1 });
  assert.deepEqual(parseComputedColor("rgba(12, 34, 56, 0.5)"), { rgb: [12, 34, 56], alpha: 0.5 });
  // The space-separated serialisation newer engines may emit.
  assert.deepEqual(parseComputedColor("rgb(12 34 56 / 25%)"), { rgb: [12, 34, 56], alpha: 0.25 });
  assert.equal(parseComputedColor("oklch(0.7 0.1 200)"), null);
  assert.equal(parseComputedColor("canvastext"), null);
  assert.equal(parseComputedColor(null), null);
});

test("every form of the same colour resolves alike", () => {
  const white = { rgb: [255, 255, 255], alpha: 1 };
  ["#fff", "#ffffff", "rgb(255, 255, 255)", "rgb(255 255 255)", "hsl(0, 0%, 100%)", "white"]
    .forEach((form) => assert.deepEqual(resolve(form), white, form));

  assert.deepEqual(resolve("rebeccapurple"), { rgb: [102, 51, 153], alpha: 1 });
  assert.deepEqual(resolve("hsl(210 50% 20%)"), { rgb: [26, 51, 77], alpha: 1 });
  assert.deepEqual(resolve("rgba(0, 0, 0, 0.5)"), { rgb: [0, 0, 0], alpha: 0.5 });
  const hexAlpha = resolve("#0000007f");
  assert.deepEqual(hexAlpha.rgb, [0, 0, 0]);
  assert.ok(Math.abs(hexAlpha.alpha - 0.5) < 0.01, `alpha ${hexAlpha.alpha}`);
});

test("colours the engine cannot resolve are reported, never guessed", () => {
  ["not-a-colour", "", "   ", "red; background: blue", null, undefined, 42]
    .forEach((value) => assert.equal(resolve(value), null, String(value)));
});

// The probe has to leave no trace: a permanent hidden node would turn up in
// anything that walks the document.
test("resolving leaves the document as it found it", () => {
  const before = dom.window.document.body.innerHTML;
  resolve("hsl(120, 60%, 40%)");
  assert.equal(dom.window.document.body.innerHTML, before);
});

test("light and dark are told apart in every notation", () => {
  ["#ffffff", "rgb(255, 255, 255)", "hsl(0, 0%, 100%)", "white", "rgb(200, 200, 200)"]
    .forEach((value) => assert.equal(dark(value), false, value));
  ["#0d1117", "rgb(13, 17, 23)", "hsl(213, 28%, 7%)", "black", "rebeccapurple"]
    .forEach((value) => assert.equal(dark(value), true, value));
});

// Translucency is a defined choice, not a syntax guess: the colour's own tone
// decides, because what shows through it is the window canvas, whose colour
// follows the very class this picks.
test("a translucent background is classified by its own colour", () => {
  assert.equal(dark("rgba(255, 255, 255, 0.2)"), false);
  assert.equal(dark("rgba(0, 0, 0, 0.2)"), true);
  assert.equal(dark("#ffffff33"), false);
  // Alpha is never read as a channel: opaque and translucent white agree.
  assert.equal(dark("rgba(255, 255, 255, 0.85)"), dark("rgb(255, 255, 255)"));
});

// oklch() computes to itself rather than to rgb(), so it stays unresolved --
// and an unresolved colour keeps the dark default the app has always used.
test("an unresolvable colour falls back to dark", () => {
  assert.equal(resolve("oklch(0.95 0.02 200)"), null);
  assert.equal(dark("oklch(0.95 0.02 200)"), true);
  assert.equal(dark("not-a-colour"), true);
});

test("only opaque colours are offered for contrast measurement", () => {
  assert.deepEqual(parseOpaque("rgb(255, 255, 255)"), [255, 255, 255]);
  assert.deepEqual(parseOpaque("teal"), [0, 128, 128]);
  assert.equal(parseOpaque("rgba(255, 255, 255, 0.9)"), null);
  assert.equal(parseOpaque("oklch(0.95 0.02 200)"), null);
});

// The classification of every shipped theme has to survive this change: the
// old reading, hex-only and luma-based, is the one users have been looking at.
test("built-in themes keep the classification they have always had", () => {
  const previously = (hex) => {
    const digits = hex.slice(1);
    const rgb = parseInt(digits.length === 3 ? [...digits].map(d => d + d).join("") : digits, 16);
    return isDarkSurface([(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff]);
  };

  assert.equal(PRESET_THEMES.length, 17);
  PRESET_THEMES.forEach((theme) => {
    assert.match(theme.background, /^#[0-9a-f]{6}$/i, `${theme.id} is hex`);
    assert.equal(dark(theme.background), previously(theme.background), theme.id);
  });
});
