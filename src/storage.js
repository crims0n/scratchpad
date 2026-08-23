// SPDX-License-Identifier: GPL-3.0-or-later

export function persistNotesLocally(storage, notes) {
  try {
    storage.setItem("scratchpad_notes", JSON.stringify(notes));
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error };
  }
}
