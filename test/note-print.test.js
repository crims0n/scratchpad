// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { marked } from "marked";
import { buildNoteHtml } from "../src/note-html-export.js";
import { printNoteDocument, waitForPrintAssets } from "../src/note-print.js";

function printingDocument(onPrint, beforePrint = () => {}) {
  const dom = new JSDOM('<title>Scratchpad</title><button id="focus">Print</button><main>App controls</main>',
    { pretendToBeVisual: true });
  const doc = dom.window.document;
  globalThis.document = doc;
  doc.getElementById("focus").focus();
  const append = doc.body.appendChild.bind(doc.body);
  let printFrame;
  doc.body.appendChild = node => {
    const result = append(node);
    if (node.tagName === "IFRAME") {
      printFrame = node;
      node.contentWindow.focus = () => {};
      node.contentWindow.print = () => onPrint(node);
      beforePrint(node);
    }
    return result;
  };
  const html = buildNoteHtml({ title: "Printed title", content: "# Only this note\n\n**fresh**", markedApi: marked });
  return { dom, doc, html, frame: () => printFrame };
}

test("print uses a sandboxed note-only frame with embedded formatting, not app controls", async () => {
  let calls = 0;
  const qa = printingDocument(frame => {
    calls += 1;
    assert.equal(frame.contentDocument.title, "Printed title");
    assert.equal(frame.contentDocument.querySelector("h1").textContent, "Only this note");
    assert.equal(frame.contentDocument.querySelectorAll("button, main, script").length, 0);
    assert.ok(frame.contentDocument.querySelector("style"));
    assert.equal(frame.getAttribute("sandbox"), "allow-same-origin allow-modals");
    assert.equal(frame.getAttribute("aria-hidden"), "true");
    assert.equal(frame.tabIndex, -1);
    assert.equal(frame.style.display, "", "frame must be renderable for printing");
    assert.equal(frame.style.left, "-10000px");
    frame.contentWindow.dispatchEvent(new frame.contentWindow.Event("afterprint"));
  });
  await printNoteDocument(qa.html, { doc: qa.doc });
  assert.equal(calls, 1);
  assert.equal(qa.doc.querySelectorAll("iframe").length, 0);
  assert.equal(qa.doc.title, "Scratchpad");
  assert.equal(qa.doc.activeElement.id, "focus");
});

test("print completion without afterprint and dialog errors both remove the temporary note", async () => {
  for (const error of [null, new Error("printer unavailable")]) {
    const qa = printingDocument(() => { if (error) throw error; });
    const operation = printNoteDocument(qa.html, { doc: qa.doc });
    if (error) await assert.rejects(operation, /printer unavailable/);
    else await operation;
    assert.equal(qa.doc.querySelectorAll("iframe").length, 0);
    assert.equal(qa.doc.activeElement.id, "focus");
  }
});

test("fonts finish before printing, and preparation timeout cleans up rather than opening a blank dialog", async () => {
  let ready;
  let calls = 0;
  const qa = printingDocument(() => { calls += 1; }, frame => {
    Object.defineProperty(frame.contentDocument, "fonts", { value: {
      ready: new Promise(resolve => { ready = resolve; })
    } });
  });
  const operation = printNoteDocument(qa.html, { doc: qa.doc });
  await Promise.resolve();
  assert.equal(calls, 0);
  ready();
  await operation;
  assert.equal(calls, 1);
  const stalled = printingDocument(() => { calls += 1; }, frame => {
    Object.defineProperty(frame.contentDocument, "fonts", { value: { ready: new Promise(() => {}) } });
  });
  await assert.rejects(printNoteDocument(stalled.html, { doc: stalled.doc, timeoutMs: 5 }), /Timed out preparing/);
  assert.equal(calls, 1);
  assert.equal(stalled.doc.querySelectorAll("iframe").length, 0);
});

test("page exit during preparation removes the frame and never opens a print dialog", async () => {
  const qa = printingDocument(() => assert.fail("must not print"), frame => {
    Object.defineProperty(frame.contentDocument, "fonts", { value: { ready: new Promise(() => {}) } });
  });
  const operation = printNoteDocument(qa.html, { doc: qa.doc });
  const printWindow = qa.frame().contentWindow;
  printWindow.dispatchEvent(new printWindow.Event("pagehide"));
  await assert.rejects(operation, /app is closing/);
  assert.equal(qa.doc.querySelectorAll("iframe").length, 0);
});

test("an unavailable print API reports failure and leaves no temporary frame", async () => {
  const qa = printingDocument(() => {}, frame => { frame.contentWindow.print = null; });
  await assert.rejects(printNoteDocument(qa.html, { doc: qa.doc }), /Printing is unavailable/);
  assert.equal(qa.doc.querySelectorAll("iframe").length, 0);
});

test("embedded images finish loading or fail before printing and stalled images time out", async () => {
  for (const eventType of ["load", "error", null]) {
    const dom = new JSDOM('<img alt="Embedded illustration">');
    const doc = dom.window.document;
    const image = doc.querySelector("img");
    Object.defineProperty(image, "complete", { value: false });
    let ready = false;
    const operation = waitForPrintAssets(doc, 20).then(() => { ready = true; });
    await Promise.resolve();
    assert.equal(ready, false);
    if (eventType) {
      image.dispatchEvent(new dom.window.Event(eventType));
      await operation;
      assert.equal(ready, true);
    } else {
      await assert.rejects(operation, /Timed out preparing/);
    }
    dom.window.close();
  }
});
