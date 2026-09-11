// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { bootApp } from "./helpers/app-harness.js";
import { ACTIVE_TEXT_PROPERTIES } from "../src/theme-colors.js";

// rgb(), hsl() and named colours are resolved now (see theme-non-hex.test.js),
// but a colour outside sRGB is not: engines compute oklch() to itself rather
// than to rgb(), so it stays unreadable in the webview exactly as it does here.
// Such a theme falls back to the dark palette -- the app's long-standing
// default -- and must still not take its active-row text from it.
const unmeasurable = {
  id: "wide-gamut",
  name: "Wide Gamut",
  background: "oklch(0.98 0.01 250)",
  foreground: "oklch(0.2 0.02 250)",
  sidebar: "oklch(0.96 0.01 250)",
  accent: "oklch(0.6 0.2 250)",
  border: "oklch(0.9 0.01 250)",
  selection: "oklch(0.9 0.05 250)",
  isCustom: true
};

test("a theme we cannot measure keeps its own foreground on the active row", async () => {
  await bootApp({
    // jsdom ships no CSS object, so the importer would reject every non-hex
    // colour before any of this ran.
    globals: { CSS: { supports: () => true } },
    storage: {
      scratchpad_active_theme: unmeasurable.id,
      scratchpad_custom_themes: [unmeasurable]
    }
  });

  const root = document.documentElement;
  assert.equal(root.style.getPropertyValue("--text-primary"), unmeasurable.foreground,
    "the theme was accepted and applied");
  assert.equal(root.classList.contains("theme-dark"), true,
    "an unresolvable colour keeps the documented default");

  // .note-item.active rebinds its text to these unconditionally, so leaving any
  // of them unset would resolve it from that fallback palette -- near-white, on
  // a row this theme paints pale.
  ACTIVE_TEXT_PROPERTIES.forEach((property) => {
    assert.equal(root.style.getPropertyValue(property), unmeasurable.foreground, property);
  });
});
