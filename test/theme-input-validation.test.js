// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";
import { isValidColor } from "../src/theme-colors.js";

let selected;
const app = await bootApp({
  // Model the permissive response to deferred CSS expressions. The app must
  // reject these before relying on the browser's color grammar validation.
  globals: { CSS: { supports: () => true } },
  handlers: { import_file_native: () => selected },
  storage: {
    scratchpad_active_theme: "unsafe-saved",
    scratchpad_custom_themes: [
      { id: "unsafe-saved", name: "Unsafe", background: "var(--other)", foreground: "#fff" },
      { id: "safe-saved", name: "Safe", background: "#101010", foreground: "#f0f0f0",
        sidebar: "url(https://example.test/image)", accent: "calc(1)",
        border: "env(other)", selection: "attr(data-color)" }
    ]
  }
});

async function importTheme(theme, title = "imported_theme.json") {
  selected = { title, content: typeof theme === "string" ? theme : JSON.stringify(theme) };
  app.click("theme-import-btn");
  await app.settle();
}

const alerts = () => app.invocations.filter(call => call.command === "show_alert_dialog");
const saved = () => app.read("scratchpad_custom_themes");

test("saved themes reject deferred colors and fall back safely when the active theme is invalid", () => {
  assert.equal(app.storage.getItem("scratchpad_active_theme"), "default-dark");
  assert.equal(document.documentElement.classList.contains("theme-dark"), true);
  const themes = saved();
  assert.deepEqual(themes.map(theme => theme.id), ["safe-saved"]);
  assert.equal(themes[0].sidebar, "#101010");
  assert.equal(themes[0].accent, "#3b82f6");
  assert.equal(themes[0].border, "rgba(128,128,128,0.2)");
  assert.equal(themes[0].selection, "rgba(59,130,246,0.2)");
});

test("invalid required colors leave the active theme and stored themes unchanged", async () => {
  const expressions = ["var(--other)", "VAR(--other, red)", "url(https://example.test/image)",
    "attr(data-color)", "env(other)", "calc(1)", "rgb(from red r g b)",
    "rgb(var(--channels))", "light-dark(white, black)", "color-mix(in srgb, red, blue)",
    "currentColor", "inherit", "red; padding: 0", 'red\" onmouseover=\"alert(1)',
    "r\\65 d", "rgb(1/**/ 2 3)", "color(--custom-profile 0.1 0.2 0.3)"];
  const stored = app.storage.getItem("scratchpad_custom_themes");
  const active = app.storage.getItem("scratchpad_active_theme");
  const styles = document.documentElement.style.cssText;
  for (const expression of expressions) {
    for (const field of ["background", "foreground"]) {
      const before = alerts().length;
      await importTheme({ name: "Invalid", background: "#101010", foreground: "#f0f0f0", [field]: expression });
      assert.equal(alerts().length, before + 1, `${field}: ${expression}`);
      assert.equal(alerts().at(-1).args.title, "Invalid Theme File");
      assert.equal(app.storage.getItem("scratchpad_custom_themes"), stored);
      assert.equal(app.storage.getItem("scratchpad_active_theme"), active);
      assert.equal(document.documentElement.style.cssText, styles);
    }
  }
});

test("invalid optional colors receive safe defaults on import", async () => {
  const before = alerts().length;
  await importTheme({ name: "Optional defaults", background: "#101010", foreground: "#f0f0f0",
    sidebar: "var(--other)", accent: "url(https://example.test/image)",
    border: "env(other)", selection: "rgb(var(--channels))" });
  const theme = saved().find(theme => theme.name === "Optional defaults");
  assert.ok(theme);
  assert.equal(theme.sidebar, "#101010");
  assert.equal(theme.accent, "#3b82f6");
  assert.equal(theme.border, "rgba(128,128,128,0.2)");
  assert.equal(theme.selection, "rgba(59,130,246,0.2)");
  assert.equal(alerts().length, before);
});

test("malformed or blank JSON names use the file name without breaking later theme selection", async () => {
  const before = alerts().length;
  for (const name of [5, true, {}, [], null, "", "   "]) {
    await importTheme({ name, background: "#101010", foreground: "#f0f0f0" }, "my_safe-theme.json");
    const matches = saved().filter(theme => theme.name === "my safe theme");
    assert.equal(matches.length, 1, JSON.stringify(name));
    assert.equal(app.storage.getItem("scratchpad_active_theme"), matches[0].id);
    assert.ok([...document.querySelectorAll(".theme-card-name")].some(card => card.textContent === "my safe theme"));
    assert.equal(alerts().length, before);
  }
});

test("trimmed names reuse an existing theme case-insensitively", async () => {
  await importTheme({ name: "  Reusable  ", background: "#101010", foreground: "#f0f0f0" });
  await importTheme({ name: "reusable", background: "#202020", foreground: "#ffffff" });
  const matches = saved().filter(theme => theme.name.toLowerCase().trim() === "reusable");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, "reusable");
  assert.equal(matches[0].background, "#202020");
});

test("literal named, functional, alpha and wide-gamut colors survive JSON import", async () => {
  const before = alerts().length;
  const colors = ["#abc", "#abcd", "#abcdef", "#abcdef80", "rebeccapurple", "transparent",
    "rgb(1 2 3)", "rgba(1, 2, 3, 0.5)", "hsl(120 50% 50%)", "hsla(120, 50%, 50%, 0.5)",
    "hwb(120 10% 20%)", "lab(50% 20 30)", "lch(50% 20 30)",
    "oklab(0.5 0.1 0.1)", "oklch(0.5 0.1 120)", "color(srgb 0.1 0.2 0.3)", "color(display-p3 0.1 0.2 0.3)"];
  for (const color of colors) {
    await importTheme({ name: "Literal", background: color, foreground: "#f0f0f0" });
    assert.equal(saved().find(theme => theme.name === "Literal").background, color);
  }
  assert.equal(alerts().length, before);
});

test("key-value themes share the same color policy and normalize whitespace names", async () => {
  await importTheme('name = "   "\nbackground = "rgb(10 20 30)"\nforeground = "white"', "key_value.toml");
  assert.ok(saved().some(theme => theme.name === "key value"));
  const before = app.storage.getItem("scratchpad_custom_themes");
  const alertCount = alerts().length;
  await importTheme('name = "bad"\nbackground = "var(--other)"\nforeground = "white"', "bad.toml");
  assert.equal(app.storage.getItem("scratchpad_custom_themes"), before);
  assert.equal(alerts().length, alertCount + 1);
});

test("non-hex literals still require browser support, while non-string colors are rejected", t => {
  t.mock.method(globalThis.CSS, "supports", () => false);
  for (const value of ["unsupported", "rgb(1 2 3)", "color(display-p3 0.1 0.2 0.3)", null, 5, {}, []]) {
    assert.equal(isValidColor(value), false);
  }
  assert.equal(isValidColor("#abcdef80"), true);
});
