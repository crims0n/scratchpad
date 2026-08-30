// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { bootApp } from "./helpers/app-harness.js";
import { WELCOME_NOTE_CONTENT, WELCOME_NOTE_TITLE } from "../src/welcome-note.js";

test("a fresh install creates the current welcome guide", async () => {
  const app = await bootApp({ handlers: { load_workspace_preference: () => null } });
  const notes = app.read("scratchpad_notes");

  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, WELCOME_NOTE_TITLE);
  assert.equal(notes[0].content, WELCOME_NOTE_CONTENT);
  assert.match(notes[0].content, /Markdown that helps as you type/);
  assert.match(notes[0].content, /syntax highlighting/);
  assert.match(notes[0].content, /line numbers/);
  assert.match(notes[0].content, /Right-click in the editor/);
  assert.match(notes[0].content, /Paste a URL over selected text/);
});
