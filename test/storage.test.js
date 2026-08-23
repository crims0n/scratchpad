// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { persistNotesLocally } from "../src/storage.js";

test("local persistence serializes the complete note collection", () => {
  const writes = new Map();
  const storage = {
    setItem(key, value) {
      writes.set(key, value);
    }
  };
  const notes = [{ id: "note-1", title: "One", content: "Hello" }];

  const result = persistNotesLocally(storage, notes);

  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(writes.get("scratchpad_notes")), notes);
});

test("local persistence reports quota failures without throwing", () => {
  const quotaError = new Error("Quota exceeded");
  const storage = {
    setItem() {
      throw quotaError;
    }
  };

  const result = persistNotesLocally(storage, []);

  assert.equal(result.ok, false);
  assert.equal(result.error, quotaError);
});
