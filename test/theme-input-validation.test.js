// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";
import { isValidColor } from "../src/theme-colors.js";

let selected;
const originalThemes = [
  { id: "unsafe-saved", name: "Unsafe", background: "var(--other)", foreground: "#fff" },
  ...["color-mix(in srgb, #222, #000)", "light-dark(white, black)", "rgb(calc(20) 20 20)",
    "rgb(from red r g b)", "Canvas"].map((background, index) => ({
    id: `legacy-${index}`, name: `Legacy ${index}`, background, foreground: "#fff", extra: { keep: true }
  })),
  { id: "safe-saved", name: "Safe", background: "#101010", foreground: "#f0f0f0",
    sidebar: "url(https://example.test/image)", accent: "calc(1)",
    border: "env(other)", selection: "attr(data-color)" }
];
const app = await bootApp({
  // Model the permissive response to deferred CSS expressions. The app must
  // reject these before relying on the browser's color grammar validation.
  globals: { CSS: { supports: () => true } },
  handlers: { import_file_native: () => selected },
  storage: {
    scratchpad_active_theme: "unsafe-saved",
    scratchpad_custom_themes: originalThemes
  }
});

async function importTheme(theme, title = "imported_theme.json") {
  selected = { title, content: typeof theme === "string" ? theme : JSON.stringify(theme) };
  app.click("theme-import-btn");
  await app.settle();
}

const alerts = () => app.invocations.filter(call => call.command === "show_alert_dialog");
const saved = () => app.read("scratchpad_custom_themes");

test("saved themes remain intact on upgrade while unsupported required colors cannot be applied", () => {
  assert.equal(app.storage.getItem("scratchpad_active_theme"), "default-dark");
  assert.equal(document.documentElement.classList.contains("theme-dark"), true);
  assert.equal(app.storage.getItem("scratchpad_custom_themes"), JSON.stringify(originalThemes));
  assert.equal(document.getElementById("theme-recovery-notice").hidden, false);
  const unavailable = [...document.querySelectorAll(".theme-card-unavailable")];
  assert.equal(unavailable.length, 6);
  for (const card of unavailable) {
    assert.equal(card.getAttribute("role"), "group");
    assert.equal(card.querySelector("[style]"), null);
    card.click();
    assert.equal(app.storage.getItem("scratchpad_active_theme"), "default-dark");
  }
});

test("unsupported themes can be exported with their original colors and extra fields", async t => {
  let blob;
  const downloads = [];
  t.mock.method(URL, "createObjectURL", value => { blob = value; return "blob:original-theme"; });
  t.mock.method(URL, "revokeObjectURL", () => {});
  t.mock.method(app.dom.window.HTMLAnchorElement.prototype, "click", function () { downloads.push(this.download); });
  const cards = [...document.querySelectorAll(".theme-card-unavailable")];
  for (const [index, card] of cards.entries()) {
    card.querySelector(".theme-recover-export").click();
    assert.deepEqual(JSON.parse(await blob.text()), originalThemes[index]);
  }
  assert.equal(downloads.length, 6);
  assert.equal(app.storage.getItem("scratchpad_custom_themes"), JSON.stringify(originalThemes));
});

test("invalid required colors leave the active theme and stored themes unchanged", async () => {
  const expressions = ["var(--other)", "VAR(--other, red)", "url(https://example.test/image)",
    "attr(data-color)", "env(other)", "calc(1)", "rgb(from red r g b)",
    "rgb(var(--channels))", "light-dark(white, black)", "color-mix(in srgb, red, blue)",
    "currentColor", "inherit", "Canvas", "CanvasText", "Highlight", "AccentColor", "ButtonFace",
    "red; padding: 0", 'red\" onmouseover=\"alert(1)',
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
      assert.match(alerts().at(-1).args.message, /fixed named colors.*RGB\/HSL\/HWB/);
      assert.match(alerts().at(-1).args.message, /CSS variables, system colors, calculations/);
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

test("only fixed named colors pass even when the browser accepts system colors", () => {
  for (const value of ["Canvas", "CanvasText", "Highlight", "AccentColor", "AccentColorText", "ButtonFace",
    "ButtonBorder", "ButtonText", "Field", "FieldText", "GrayText", "LinkText", "Mark", "MarkText",
    "SelectedItem", "SelectedItemText", "VisitedText", "ActiveText", "ActiveBorder", "WindowText", "Menu", "Background"]) {
    assert.equal(isValidColor(value), false, value);
  }
  for (const value of ["RebeccaPurple", "aliceblue", "darkgrey", "lightgoldenrodyellow", "yellowgreen", "transparent"]) {
    assert.equal(isValidColor(value), true, value);
  }
});

test("JSON and key-value imports trim every color before it is stored or applied", async () => {
  const values = { name: "Trimmed", background: "\n#101010 ", foreground: "\twhite ", sidebar: " #252526 ",
    accent: " rgb(1 2 3) ", border: " rgba(1, 2, 3, 0.5) ", selection: " hsl(120 50% 50%) " };
  await importTheme(values);
  const expected = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()]));
  for (const [key, value] of Object.entries(expected)) assert.equal(saved().find(theme => theme.name === "Trimmed")[key], value);
  assert.equal(document.documentElement.style.getPropertyValue("--bg-app"), "#101010");

  await importTheme('name = "Trimmed KV"\nbackground = "  #101010  " # comment\nforeground = " white "\nsidebar = #252526\naccent = " rgb(1 2 3) "\nborder = " rgba(1, 2, 3, 0.5) "\nselection = " hsl(120 50% 50%) "', "trimmed.toml");
  const kv = saved().find(theme => theme.name === "Trimmed KV");
  assert.ok(kv);
  for (const [key, value] of Object.entries(expected)) if (key !== "name") assert.equal(kv[key], value);
});

test("valid alias colors are used when higher-priority fields are unsupported", async () => {
  const before = alerts().length;
  const colors = { background: "var(--other)", "editor.background": " #101010 ", foreground: "CanvasText",
    "editor.foreground": " #f0f0f0 ", sidebar: "var(--other)", "sideBar.background": " #252526 ",
    accent: "calc(1)", "editorCursor.foreground": " #ff0000 ", border: "env(other)", "panel.border": " #222222 ",
    selection: "light-dark(white, black)", "editor.selectionBackground": " #333333 " };
  const expected = { background: "#101010", foreground: "#f0f0f0", sidebar: "#252526", accent: "#ff0000",
    border: "#222222", selection: "#333333" };
  await importTheme({ name: "Aliases", colors });
  for (const [key, value] of Object.entries(expected)) assert.equal(saved().find(theme => theme.name === "Aliases")[key], value);
  const kv = Object.entries(colors).map(([key, value]) => `${key} = "${value}"`).join("\n");
  await importTheme(`name = "Aliases KV"\n${kv}`, "aliases.toml");
  for (const [key, value] of Object.entries(expected)) assert.equal(saved().find(theme => theme.name === "Aliases KV")[key], value);
  assert.equal(alerts().length, before);
});

test("unrelated imports and theme deletions preserve all original saved theme fields", async () => {
  for (const original of originalThemes) assert.deepEqual(saved().find(theme => theme.id === original.id), original);
  const card = [...document.querySelectorAll(".theme-card")]
    .find(card => card.querySelector(".theme-card-name")?.textContent === "reusable");
  assert.ok(card);
  card.querySelector(".theme-card-delete").click();
  assert.equal(saved().some(theme => theme.name === "reusable"), false);
  for (const original of originalThemes) assert.deepEqual(saved().find(theme => theme.id === original.id), original);
});

test("a corrected reimport explicitly replaces one unsupported theme and leaves the others recoverable", async () => {
  await importTheme({ name: "Legacy 0", background: "#101010", foreground: "#f0f0f0" });
  const matches = saved().filter(theme => theme.name === "Legacy 0");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].background, "#101010");
  assert.equal(document.querySelectorAll(".theme-card-unavailable").length, 5);
  for (const original of originalThemes.filter(theme => theme.id !== "legacy-0")) {
    assert.deepEqual(saved().find(theme => theme.id === original.id), original);
  }
});

test("a failed storage write keeps the active theme, picker and original records unchanged", async t => {
  const before = app.storage.getItem("scratchpad_custom_themes");
  const active = app.storage.getItem("scratchpad_active_theme");
  const grid = document.getElementById("theme-grid").textContent;
  const original = app.dom.window.Storage.prototype.setItem;
  t.mock.method(app.dom.window.Storage.prototype, "setItem", function (key, value) {
    if (key === "scratchpad_custom_themes") throw new Error("storage full");
    return original.call(this, key, value);
  });
  await importTheme({ name: "Failed import", background: "#101010", foreground: "#f0f0f0" });
  assert.equal(app.storage.getItem("scratchpad_custom_themes"), before);
  assert.equal(app.storage.getItem("scratchpad_active_theme"), active);
  assert.equal(document.getElementById("theme-grid").textContent, grid);
  assert.equal(alerts().at(-1).args.title, "Theme Import Error");
});

test("restart preserves original theme records and exposes unsupported themes for recovery again", async () => {
  const storage = app.dumpStorage();
  const before = storage.scratchpad_custom_themes;
  const next = await bootApp({ instance: 2, globals: { CSS: { supports: () => true } },
    storage: { ...storage, scratchpad_active_theme: "legacy-1" } });
  assert.equal(next.storage.getItem("scratchpad_custom_themes"), before);
  assert.equal(next.storage.getItem("scratchpad_active_theme"), "default-dark");
  assert.equal(document.querySelectorAll(".theme-card-unavailable").length, 5);
  assert.equal(document.getElementById("theme-recovery-notice").hidden, false);
  assert.deepEqual(next.read("scratchpad_custom_themes").find(theme => theme.id === "safe-saved"), originalThemes.at(-1));
});
