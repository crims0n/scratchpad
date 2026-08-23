// SPDX-License-Identifier: GPL-3.0-or-later

// Boots the real frontend against index.html with a stubbed Tauri bridge.
//
// main.js holds module-level state and runs its start-up sequence on import, so
// a process can only boot the app once: give every start-up scenario its own
// test file. Nothing here runs until bootApp is called.

import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

export const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

// `storage` seeds local storage before boot; `handlers` maps a Tauri command to
// the value it should resolve with, or throws to simulate a failing command.
// `instance` gives the module a distinct URL so a single process can boot the
// app more than once, which is what a two-launch test needs.
export async function bootApp({ storage = {}, handlers = {}, instance = 1 } = {}) {
  const html = await readFile(new URL("../../src/index.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true });

  const invocations = [];
  async function invoke(command, args) {
    invocations.push({ command, args });
    const handler = handlers[command];
    return typeof handler === "function" ? handler(args) : null;
  }

  dom.window.__TAURI__ = { core: { invoke }, window: {} };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true
  });

  Object.entries(storage).forEach(([key, value]) => {
    dom.window.localStorage.setItem(
      key,
      typeof value === "string" ? value : JSON.stringify(value)
    );
  });

  await import(`${new URL("../../src/main.js", import.meta.url).href}?boot=${instance}`);
  await settle();

  return {
    dom,
    invocations,
    settle,
    storage: dom.window.localStorage,
    // Everything local storage holds, ready to seed the next launch.
    dumpStorage: () => {
      const contents = {};
      for (let index = 0; index < dom.window.localStorage.length; index += 1) {
        const key = dom.window.localStorage.key(index);
        contents[key] = dom.window.localStorage.getItem(key);
      }
      return contents;
    },
    type: async (text) => {
      const editor = dom.window.document.getElementById("editor-textarea");
      editor.value = text;
      editor.dispatchEvent(new dom.window.Event("input"));
      await settle(600);
    },
    read: (key) => {
      const raw = dom.window.localStorage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    },
    click: (id) => dom.window.document.getElementById(id).click(),
    sidebarTitles: () =>
      [...dom.window.document.querySelectorAll(".note-item-title")]
        .map((element) => element.textContent)
  };
}
