// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { createEditorRenderScheduler } from "../src/editor-render-scheduler.js";
import { getAppElement, editorContent, bootApp } from "./helpers/app-harness.js";

test("editor render scheduler coalesces work and supports cancellation", () => {
  const frames = new Map();
  let nextFrameId = 1;
  let renderCount = 0;
  const scheduler = createEditorRenderScheduler(
    () => { renderCount += 1; },
    {
      requestFrame: (callback) => {
        const frameId = nextFrameId++;
        frames.set(frameId, callback);
        return frameId;
      },
      cancelFrame: (frameId) => frames.delete(frameId)
    }
  );

  scheduler.schedule();
  scheduler.schedule();
  scheduler.schedule();
  assert.equal(frames.size, 1);
  assert.equal(renderCount, 0);

  const [firstFrameId, firstFrame] = frames.entries().next().value;
  frames.delete(firstFrameId);
  firstFrame();
  assert.equal(renderCount, 1);

  scheduler.schedule();
  assert.equal(frames.size, 1);
  scheduler.cancel();
  assert.equal(frames.size, 0);
  assert.equal(renderCount, 1);
});

test("editor input defers syntax decoration and uses the latest value", async () => {
  const app = await bootApp({
    storage: {
      scratchpad_notes: [{
        id: "render-note",
        title: "Render note",
        content: "initial",
        updatedAt: 2,
        isTitleLocked: true
      }, {
        id: "secondary-render-note",
        title: "Secondary render note",
        content: "secondary initial",
        updatedAt: 1,
        isTitleLocked: true
      }]
    }
  });
  const editor = getAppElement("editor");
  const backdrop = editorContent("editor");


  for (const value of ["first", "second", "# final"]) {
    editor.value = value;
    editor.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
  }

  assert.equal(backdrop.querySelector(".syntax-heading"), null);
  await app.settle(30);
  assert.equal(editor.value, "# final");
  assert.equal(backdrop.querySelector(".syntax-heading").textContent, "final");

  document.getElementById("split-note-btn").click();
  const secondaryEditor = getAppElement("secondary-editor");
  const secondaryBackdrop = editorContent("secondary-editor");


  for (const value of ["secondary first", "secondary second", "## secondary final"]) {
    secondaryEditor.value = value;
    secondaryEditor.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
  }

  assert.equal(secondaryBackdrop.querySelector(".syntax-heading"), null);
  await app.settle(30);
  assert.equal(secondaryEditor.value, "## secondary final");
  assert.equal(secondaryBackdrop.querySelector(".syntax-heading").textContent, "secondary final");
});
