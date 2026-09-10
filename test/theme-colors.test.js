// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { PRESET_THEMES } from "../src/preset-themes.js";
import {
  DERIVED_THEME_PROPERTIES,
  contrastRatio,
  deriveThemeSurfaceColors,
  ensureContrast,
  mix,
  parseColor,
  toHex
} from "../src/theme-colors.js";

// WCAG AA for body text. The sidebar snippet is 0.8rem, so it needs the full
// 4.5:1 rather than the 3:1 large-text allowance.
const AA = 4.5;

const ratio = (a, b) => contrastRatio(parseColor(a), parseColor(b));

test("parseColor reads every hex form and rejects everything else", () => {
  assert.deepEqual(parseColor("#fff"), [255, 255, 255]);
  assert.deepEqual(parseColor("#0d1117"), [13, 17, 23]);
  assert.deepEqual(parseColor("  #0D1117  "), [13, 17, 23]);
  assert.equal(parseColor("rebeccapurple"), null);
  assert.equal(parseColor("rgba(59,130,246,0.15)"), null);
  assert.equal(parseColor("#12345"), null);
  assert.equal(parseColor("#gggggg"), null);
  assert.equal(parseColor(undefined), null);

  // Translucent hex is unmeasurable, not "opaque with the alpha ignored" --
  // treating #1f6feb66 as #1f6feb would measure against the wrong surface and
  // hand back an opaque colour the theme never asked for.
  assert.equal(parseColor("#1f6feb66"), null);
  assert.equal(parseColor("#f0f8"), null);
});

test("contrastRatio matches the WCAG reference values", () => {
  assert.equal(Number(ratio("#ffffff", "#000000").toFixed(2)), 21);
  assert.equal(Number(ratio("#ffffff", "#ffffff").toFixed(2)), 1);
  // The bug as reported: GitHub Dark's muted snippet on its selection blue.
  assert.ok(ratio("#6b7280", "#1f6feb") < 1.1);
});

test("ensureContrast lifts text to the target against the worst surface", () => {
  const surfaces = [parseColor("#010409"), parseColor("#0d1117")];
  const lifted = ensureContrast(parseColor("#1a1d21"), surfaces, AA);

  surfaces.forEach((surface) => {
    assert.ok(contrastRatio(lifted, surface) >= AA, `${toHex(lifted)} on ${toHex(surface)}`);
  });
});

test("ensureContrast leaves colours that already clear the target untouched", () => {
  const color = parseColor("#ffffff");
  assert.deepEqual(ensureContrast(color, [parseColor("#000000")], AA), color);
});

test("ensureContrast returns its closest attempt when the target is unreachable", () => {
  // Nothing reaches 21:1 on a mid grey, so this must still return a colour.
  const result = ensureContrast(parseColor("#808080"), [parseColor("#808080")], 21);
  assert.ok(Array.isArray(result) && result.length === 3);
});

test("mix interpolates channel by channel", () => {
  assert.deepEqual(mix([0, 0, 0], [100, 200, 50], 0.5), [50, 100, 25]);
});

test("deriveThemeSurfaceColors declines themes whose colours it cannot parse", () => {
  assert.equal(deriveThemeSurfaceColors(null), null);
  assert.equal(deriveThemeSurfaceColors({ background: "papayawhip", foreground: "#000" }), null);
  assert.equal(deriveThemeSurfaceColors({ background: "#000", foreground: "var(--x)" }), null);
});

test("every preset theme keeps sidebar text readable on idle, hover and active rows", () => {
  const failures = [];

  PRESET_THEMES.forEach((theme) => {
    const derived = deriveThemeSurfaceColors(theme);
    assert.ok(derived, `${theme.id} should be derivable`);

    // The note title uses the theme's own foreground, and a theme is entitled to
    // its own pairing there (Solarized is deliberately low contrast). What this
    // module owns is the dimmer tones, plus every tone on the active row, whose
    // background the app -- not the theme author -- chose to put text on.
    const idleSurfaces = [theme.background, theme.sidebar || theme.background, derived["--bg-note-hover"]];
    const checks = [
      ...idleSurfaces.flatMap((surface) => [
        [derived["--text-secondary"], surface, "meta"],
        [derived["--text-muted"], surface, "snippet"]
      ]),
      [derived["--text-on-active"], derived["--bg-note-active"], "active title"],
      [derived["--text-secondary-on-active"], derived["--bg-note-active"], "active meta"],
      [derived["--text-muted-on-active"], derived["--bg-note-active"], "active snippet"]
    ];

    checks.forEach(([text, surface, label]) => {
      const measured = ratio(text, surface);
      if (measured < AA) {
        failures.push(`${theme.id} ${label}: ${text} on ${surface} is ${measured.toFixed(2)}:1`);
      }
    });
  });

  assert.deepEqual(failures, []);
});

test("GitHub Dark's active note no longer paints text onto raw selection blue", () => {
  const theme = PRESET_THEMES.find(t => t.id === "github-dark");
  const derived = deriveThemeSurfaceColors(theme);

  assert.notEqual(derived["--bg-note-active"], theme.selection);
  // Still recognisably the theme's blue, just dark enough to carry two tones.
  const [r, g, b] = parseColor(derived["--bg-note-active"]);
  assert.ok(b > r && b > g, "active surface stays blue");
  assert.ok(ratio(derived["--text-muted-on-active"], derived["--bg-note-active"]) >= AA);
});

test("themes whose selection already carries text keep it exactly", () => {
  const dracula = PRESET_THEMES.find(t => t.id === "dracula");
  assert.equal(deriveThemeSurfaceColors(dracula)["--bg-note-active"], dracula.selection);
});

test("a selection colour we cannot measure is left as the theme declared it", () => {
  const derived = deriveThemeSurfaceColors({
    background: "#0d1117",
    foreground: "#c9d1d9",
    sidebar: "#010409",
    selection: "rgba(31, 111, 235, 0.4)"
  });

  assert.ok(derived["--text-muted"], "the tones we can measure are still derived");
  assert.ok(!("--bg-note-active" in derived));
  assert.ok(!("--text-muted-on-active" in derived));
});

test("a theme with no selection at all gets a tint of its own sidebar", () => {
  const derived = deriveThemeSurfaceColors({
    background: "#0d1117",
    foreground: "#c9d1d9",
    sidebar: "#010409"
  });

  assert.ok(derived["--bg-note-active"]);
  assert.ok(ratio(derived["--text-muted-on-active"], derived["--bg-note-active"]) >= AA);
});

test("a translucent selection is left alone rather than flattened to opaque", () => {
  const derived = deriveThemeSurfaceColors({
    background: "#0d1117",
    foreground: "#c9d1d9",
    sidebar: "#010409",
    selection: "#1f6feb66"
  });

  assert.ok(derived["--text-muted"], "the tones we can measure are still derived");
  assert.ok(!("--bg-note-active" in derived));
  assert.ok(!("--text-muted-on-active" in derived));
});

test("a translucent background or foreground makes the whole theme unmeasurable", () => {
  assert.equal(deriveThemeSurfaceColors({ background: "#0d111780", foreground: "#c9d1d9" }), null);
  assert.equal(deriveThemeSurfaceColors({ background: "#0d1117", foreground: "#c9d1d980" }), null);
});

test("DERIVED_THEME_PROPERTIES covers everything a derivation can return", () => {
  const full = deriveThemeSurfaceColors(PRESET_THEMES[0]);
  assert.deepEqual(Object.keys(full).sort(), [...DERIVED_THEME_PROPERTIES].sort());

  // Partial derivations must stay a subset, or callers clearing the list would
  // leave a stale property behind.
  const partial = deriveThemeSurfaceColors({
    background: "#0d1117",
    foreground: "#c9d1d9",
    selection: "rgb(31 111 235)"
  });
  Object.keys(partial).forEach((property) => {
    assert.ok(DERIVED_THEME_PROPERTIES.includes(property), property);
  });
});
