// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { bootApp, getAppElement } from "./helpers/app-harness.js";

test("closing with a print preview saves before destruction and a failed save cancels closing", async () => {
  let closeHandler;
  let previewOpen = false;
  let fail = false;
  let destroyed = 0;
  let saved = [];
  const app = await bootApp({ handlers: {
    load_workspace_preference: () => "/tmp/print-close.sqlite",
    load_db_notes: () => [{ id: "note", title: "Note", content: "# Original", updatedAt: 1, isTitleLocked: true }],
    open_note_print: () => { previewOpen = true; },
    save_workspace_db: ({ notes }) => {
      if (fail) throw new Error("Disk full");
      saved = structuredClone(notes);
    }
  }, windowApi: { getCurrentWindow: () => ({
    onCloseRequested: async handler => { closeHandler = handler; },
    destroy: async () => {
      assert.equal(saved[0].content, "# Latest edit", "pending edits reach persistence before native destruction");
      destroyed += 1;
    }
  }) } });
  app.click("print-note-btn");
  await app.settle();
  assert.equal(previewOpen, true);
  fail = true;
  getAppElement("editor").applyEdit({ value: "# Latest edit", selectionStart: 0, selectionEnd: 0 });
  await closeHandler({ preventDefault() {} });
  assert.equal(destroyed, 0);
  assert.equal(previewOpen, true);
  assert.match(document.getElementById("save-status").textContent, /close cancelled/);
  fail = false;
  await closeHandler({ preventDefault() {} });
  assert.equal(destroyed, 1);
});
