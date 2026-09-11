// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { bootApp } from "./helpers/app-harness.js";
import { ACTIVE_TEXT_PROPERTIES } from "../src/theme-colors.js";

// An imported theme is allowed any CSS colour the browser accepts, and this one
// is light while spelling none of its colours in hex. isColorDark can only read
// hex, so it guesses dark and the app hangs the dark palette on a white theme.
// That misclassification predates this work; what matters here is that the
// active row does not take its text from that wrong palette.
const nonHexLight = {
  id: "rgb-light",
  name: "RGB Light",
  background: "rgb(255, 255, 255)",
  foreground: "rgb(0, 0, 0)",
  sidebar: "rgb(255, 255, 255)",
  accent: "rgb(59, 130, 246)",
  border: "rgb(200, 200, 200)",
  selection: "rgba(59, 130, 246, 0.2)",
  isCustom: true
};

test("a theme we cannot measure keeps its own foreground on the active row", async () => {
  await bootApp({
    // jsdom ships no CSS object, so the importer would reject every rgb() colour.
    globals: { CSS: { supports: () => true } },
    storage: {
      scratchpad_active_theme: nonHexLight.id,
      scratchpad_custom_themes: [nonHexLight]
    }
  });

  const root = document.documentElement;
  assert.equal(root.style.getPropertyValue("--text-primary"), nonHexLight.foreground,
    "the theme was accepted and applied");

  // .note-item.active rebinds its text to these unconditionally, so leaving any
  // of them unset would resolve it from the built-in palette -- near-white, on
  // this theme's pale row.
  ACTIVE_TEXT_PROPERTIES.forEach((property) => {
    assert.equal(root.style.getPropertyValue(property), nonHexLight.foreground, property);
  });
});
