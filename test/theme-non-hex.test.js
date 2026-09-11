// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { bootApp } from "./helpers/app-harness.js";
import { contrastRatio, parseColor } from "../src/theme-colors.js";
import { createCssColorResolver, createOpaqueColorParser } from "../src/css-color.js";

// Import accepts any colour the engine supports, so a theme may spell none of
// itself in hex. Both of these are unambiguous -- one white, one near-black.
const rgbLight = {
  id: "rgb-light",
  name: "RGB Light",
  background: "rgb(255, 255, 255)",
  foreground: "rgb(17, 17, 17)",
  sidebar: "rgb(246, 247, 249)",
  accent: "rgb(59, 130, 246)",
  border: "rgb(200, 200, 200)",
  selection: "rgb(219, 234, 254)",
  isCustom: true
};

const namedDark = {
  id: "named-dark",
  name: "Named Dark",
  background: "hsl(213, 28%, 7%)",
  foreground: "gainsboro",
  sidebar: "black",
  accent: "cornflowerblue",
  border: "dimgray",
  selection: "midnightblue",
  isCustom: true
};

const app = await bootApp({
  // jsdom ships no CSS object, so the importer would reject every non-hex
  // colour before the classification under test ever ran.
  globals: { CSS: { supports: () => true } },
  storage: {
    scratchpad_active_theme: rgbLight.id,
    scratchpad_custom_themes: [rgbLight, namedDark]
  }
});

const root = document.documentElement;
const parseOpaque = createOpaqueColorParser(createCssColorResolver(document));
const selectTheme = (name) => {
  const card = [...document.querySelectorAll(".theme-card")]
    .find(element => element.textContent.includes(name));
  assert.ok(card, `${name} is offered in the grid`);
  card.click();
};

test("a white rgb() theme is classified light, not dark", () => {
  assert.equal(root.style.getPropertyValue("--bg-app"), rgbLight.background, "the theme applied");
  assert.equal(root.classList.contains("theme-light"), true);
  assert.equal(root.classList.contains("theme-dark"), false);
});

// Classification decides which built-in palette fills in what the theme leaves
// unset, and the derived tones are measured against the theme's own surfaces.
// Neither could happen while the colours were unreadable.
test("its sidebar tones are derived and readable", () => {
  const sidebar = parseOpaque(rgbLight.sidebar);
  ["--text-secondary", "--text-muted"].forEach((property) => {
    const tone = parseColor(root.style.getPropertyValue(property));
    assert.ok(tone, `${property} is derived`);
    assert.ok(contrastRatio(tone, sidebar) >= 4.5, `${property} on the sidebar`);
  });

  const activeBackground = parseColor(root.style.getPropertyValue("--bg-note-active"));
  const activeSnippet = parseColor(root.style.getPropertyValue("--text-muted-on-active"));
  assert.ok(contrastRatio(activeSnippet, activeBackground) >= 4.5, "the active snippet");
});

test("an hsl() and named-colour theme is classified dark", () => {
  selectTheme(namedDark.name);

  assert.equal(root.classList.contains("theme-dark"), true);
  assert.equal(root.classList.contains("theme-light"), false);

  const sidebar = parseOpaque(namedDark.sidebar);
  const muted = parseColor(root.style.getPropertyValue("--text-muted"));
  assert.ok(muted, "--text-muted is derived from named colours");
  assert.ok(contrastRatio(muted, sidebar) >= 4.5, "--text-muted on the sidebar");
});

test("switching back to the light theme reclassifies it", () => {
  selectTheme(rgbLight.name);
  assert.equal(root.classList.contains("theme-light"), true);
  assert.equal(root.classList.contains("theme-dark"), false);
  assert.equal(app.storage.getItem("scratchpad_active_theme"), rgbLight.id);
});
