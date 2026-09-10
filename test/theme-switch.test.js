// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { bootApp } from "./helpers/app-harness.js";
import { DERIVED_THEME_PROPERTIES, contrastRatio, parseColor } from "../src/theme-colors.js";

// A theme we can only partly measure: hex surfaces, but a selection colour that
// carries alpha. It sets some derived properties and not others, which is how a
// previous theme's tones can survive a switch.
const partlyMeasurable = {
  id: "pale-import",
  name: "Pale Import",
  background: "#fafafa",
  foreground: "#222222",
  sidebar: "#f0f4ff",
  accent: "#3366cc",
  border: "#ccddee",
  selection: "#3366cc40",
  isCustom: true
};

test("switching away from a dark theme leaves none of its tones behind", async () => {
  await bootApp({
    storage: {
      scratchpad_active_theme: "github-dark",
      scratchpad_custom_themes: [partlyMeasurable]
    }
  });

  const root = document.documentElement;
  assert.equal(root.style.getPropertyValue("--text-on-active"), "#c9d1d9", "GitHub Dark is active");

  const card = [...document.querySelectorAll(".theme-card")]
    .find(element => element.textContent.includes(partlyMeasurable.name));
  assert.ok(card, "the imported theme is offered in the grid");
  card.click();

  assert.ok(root.classList.contains("theme-light"));

  // Anything the new theme could not derive must fall back to the stylesheet,
  // never to the colour the old theme left on the element.
  const stale = DERIVED_THEME_PROPERTIES
    .filter(property => root.style.getPropertyValue(property) === "#c9d1d9");
  assert.deepEqual(stale, []);

  assert.equal(root.style.getPropertyValue("--text-on-active"), "");
  assert.equal(root.style.getPropertyValue("--text-secondary-on-active"), "");
  assert.equal(root.style.getPropertyValue("--text-muted-on-active"), "");

  // The tones it can measure are still derived, and still readable.
  const muted = parseColor(root.style.getPropertyValue("--text-muted"));
  assert.ok(contrastRatio(muted, parseColor(partlyMeasurable.sidebar)) >= 4.5);
});
