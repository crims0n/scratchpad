// SPDX-License-Identifier: GPL-3.0-or-later

// Boots the real frontend against index.html with a stubbed Tauri bridge.
//
// main.js holds module-level state and runs its start-up sequence on import, so
// a process can only boot the app once: give every start-up scenario its own
// test file. Nothing here runs until bootApp is called.

import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import * as Diff from "diff";
import { after } from "node:test";
import { getNoteEditor } from "../../src/note-editor.js";

export function getAppElement(id, doc = document) {
  const element = doc.getElementById(id);
  return getNoteEditor(element) ?? element;
}
export const editorContent = (id = "editor") => getAppElement(id).contentDOM;
let previousEditors = [];
after(() => previousEditors.forEach(editor => editor.destroy()));

export const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

// `storage` seeds local storage before boot; `handlers` maps a Tauri command to
// the value it should resolve with, or throws to simulate a failing command.
// `instance` gives the module a distinct URL so a single process can boot the
// app more than once, which is what a two-launch test needs. `globals` installs
// globals jsdom does not implement -- `CSS.supports`, say, which the app uses to
// validate imported theme colours.
export async function bootApp({ storage = {}, handlers = {}, instance = 1, windowApi = {}, globals = {}, beforeBoot,
  recoveryCopies = [], storageQuota = 5000000 } = {}) {
  previousEditors.forEach(editor => editor.destroy());
  previousEditors = [];
  const html = await readFile(new URL("../../src/index.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true, storageQuota });

  const invocations = [];
  async function invoke(command, args) {
    invocations.push({ command, args });
    const handler = handlers[command];
    if (typeof handler === "function") return handler(args);
    if (command === "archive_local_recovery") {
      recoveryCopies.push(args.content);
      return `/tmp/recovery-${recoveryCopies.length}.json`;
    }
    if (command === "has_local_recovery_copies") return recoveryCopies.length > 0;
    if (command === "read_local_recovery_copies") return [...recoveryCopies];
    if (command === "load_db_folders" || command === "load_db_trash") return [];
    return null;
  }

  const eventListeners = new Map();
  dom.window.__TAURI__ = {
    core: { invoke }, window: windowApi,
    event: { listen: async (name, handler) => {
      eventListeners.set(name, handler);
      return () => eventListeners.delete(name);
    } }
  };
  dom.window.Diff = Diff;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Window = dom.window.Window;
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  if (!dom.window.Range.prototype.getClientRects) dom.window.Range.prototype.getClientRects = () => [];
  if (!dom.window.Range.prototype.getBoundingClientRect) dom.window.Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });
  globalThis.localStorage = dom.window.localStorage;
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true
  });

  // main.js reads these as bare globals, so they have to land on globalThis as
  // well as on the window the app sees.
  Object.entries(globals).forEach(([name, value]) => {
    dom.window[name] = value;
    globalThis[name] = value;
  });

  Object.entries(storage).forEach(([key, value]) => {
    dom.window.localStorage.setItem(
      key,
      typeof value === "string" ? value : JSON.stringify(value)
    );
  });

  // Install storage-failure simulations after seeding but before startup reads.
  await beforeBoot?.(dom.window);

  await import(`${new URL("../../src/main.js", import.meta.url).href}?boot=${instance}`);
  previousEditors = [getAppElement("editor"), getAppElement("secondary-editor")];
  const closeWindow = dom.window.close.bind(dom.window);
  dom.window.close = () => {
    const ownedEditors = [getAppElement("editor", dom.window.document), getAppElement("secondary-editor", dom.window.document)];
    ownedEditors.forEach(editor => editor?.destroy());
    previousEditors = previousEditors.filter(editor => !ownedEditors.includes(editor));
    closeWindow();
  };
  await settle();

  return {
    dom,
    emit: (name, payload) => eventListeners.get(name)?.({ payload }),
    invocations,
    recoveryCopies,
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
      const editor = getAppElement("editor", dom.window.document);
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
