// SPDX-License-Identifier: GPL-3.0-or-later

import { buildNoteHtml } from "./note-html-export.js";
import { waitForPrintAssets } from "./note-print.js";

const { invoke } = window.__TAURI__.core;
const printButton = document.getElementById("print-btn");
const status = document.getElementById("print-status");
let ready = false;
let busy = false;

async function print() {
  if (!ready || busy) return;
  busy = true;
  printButton.disabled = true;
  status.textContent = "Opening system print dialog…";
  try {
    await waitForPrintAssets(document);
    await invoke("print_note_native");
    // Native dialogs do not reliably report cancel vs printed, or emit
    // afterprint. Keep this immutable preview until the user closes it.
    status.textContent = "Close this window when finished.";
  } catch (error) {
    status.textContent = "Could not print note: " + error;
  } finally {
    busy = false;
    printButton.disabled = false;
  }
}

printButton.addEventListener("click", print);
document.getElementById("close-btn").addEventListener("click", () => {
  window.__TAURI__.window.getCurrentWindow().close().catch(error => {
    status.textContent = "Could not close print window: " + error;
  });
});
document.addEventListener("click", event => {
  if (event.target.closest?.("a")) event.preventDefault();
});
document.addEventListener("keydown", event => {
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "p") {
    event.preventDefault();
    print();
  }
});

try {
  const snapshot = await invoke("get_print_note");
  // The native snapshot is Markdown, never trusted HTML. Apply the exact same
  // sanitizer here as Preview and HTML export before anything enters the DOM.
  const html = buildNoteHtml(snapshot);
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const style = document.createElement("style");
  style.textContent = parsed.querySelector("style").textContent;
  document.head.appendChild(style);
  document.title = snapshot.title;
  document.getElementById("print-content").appendChild(document.importNode(parsed.querySelector("article"), true));
  ready = true;
  await print();
} catch (error) {
  status.textContent = "Could not prepare note for printing: " + error;
}
