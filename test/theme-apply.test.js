// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { bootApp } from "./helpers/app-harness.js";
import { PRESET_THEMES } from "../src/preset-themes.js";
import { contrastRatio, deriveThemeSurfaceColors, parseColor } from "../src/theme-colors.js";

const githubDark = PRESET_THEMES.find(theme => theme.id === "github-dark");

test("applying GitHub Dark publishes readable sidebar tones onto the root element", async () => {
  await bootApp({ storage: { scratchpad_active_theme: "github-dark" } });

  const root = document.documentElement;
  const expected = deriveThemeSurfaceColors(githubDark);

  assert.ok(root.classList.contains("theme-dark"));
  assert.equal(root.style.getPropertyValue("--bg-sidebar"), githubDark.sidebar);

  Object.entries(expected).forEach(([property, value]) => {
    assert.equal(root.style.getPropertyValue(property), value, property);
  });

  // The snippet in the sidebar preview -- the text the bug report calls out.
  const snippet = parseColor(root.style.getPropertyValue("--text-muted"));
  assert.ok(contrastRatio(snippet, parseColor(githubDark.sidebar)) >= 4.5);

  const activeSnippet = parseColor(root.style.getPropertyValue("--text-muted-on-active"));
  const activeSurface = parseColor(root.style.getPropertyValue("--bg-note-active"));
  assert.ok(contrastRatio(activeSnippet, activeSurface) >= 4.5);
});
