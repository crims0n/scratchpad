// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { bootApp, getAppElement } from "./helpers/app-harness.js";

test("MCP appends preserve each pane's folds, cursor, and mapped undo/redo history", async () => {
  const source = "# First\nbody\n# Next\nlast";
  const app = await bootApp({ storage: { scratchpad_notes: [
    { id: "primary", title: "Primary", content: source, updatedAt: 2, isTitleLocked: true },
    { id: "secondary", title: "Secondary", content: source, updatedAt: 1, isTitleLocked: true }
  ] }, handlers: { start_mcp_server: () => ({ command: "/scratchpad", args: ["--mcp-stdio"] }) } });
  app.click("split-note-btn");
  app.click("agent-access-toggle-btn"); await app.settle();
  app.click("mcp-permission-append_to_note"); await app.settle();
  for (const [id, editor] of [["primary", getAppElement("editor")], ["secondary", getAppElement("secondary-editor")]]) {
    const edited = source.replace("body", `${id} edited body`);
    editor.applyEdit({ value: edited, selectionStart: edited.length, selectionEnd: edited.length });
    editor.toggleFold(1);
    const folds = editor.foldedRanges;
    let inputs = 0;
    editor.addEventListener("input", () => inputs += 1);
    await app.settle(70);
    const snapshot = app.invocations.findLast(item => item.command === "update_mcp_snapshot").args;
    const update = app.invocations.findLast(item => item.command === "update_mcp_note" && item.args.note.id === id).args;
    const args = { collectionId: snapshot.collectionId, requestId: id, noteId: id,
      expectedRevision: update.revision, content: "\nAgent append" };
    for (const ticket of [id, `${id}-retry`]) {
      await app.emit("mcp-write-request", { ticket, operation: "append_to_note", arguments: args });
      const result = app.invocations.findLast(item => item.command === "complete_mcp_write").args.result;
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(editor.value, edited + args.content);
      assert.deepEqual(editor.foldedRanges, folds);
      assert.equal(editor.selectionStart, edited.length, "an end-of-document cursor stays before the append");
      assert.equal(inputs, 0, "remote updates do not emit duplicate user input");
    }
    assert.equal(editor.undo(), true);
    assert.equal(editor.value, source + args.content, "Undo removes the user's edit and retains the agent append");
    assert.equal(editor.redo(), true);
    assert.equal(editor.value, edited + args.content);
    const later = editor.value + "\nLater user edit";
    editor.applyEdit({ value: later, selectionStart: later.length, selectionEnd: later.length });
    assert.equal(editor.undo(), true);
    assert.equal(editor.value, edited + args.content);
    assert.equal(editor.undo(), true);
    assert.equal(editor.value, source + args.content);
  }
  await app.settle(600);
  for (const note of app.read("scratchpad_notes")) assert.equal(note.content, source + "\nAgent append");
});
