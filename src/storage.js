// SPDX-License-Identifier: GPL-3.0-or-later

export const LOCAL_NOTES_KEY = "scratchpad_notes";

// Where the local-only collection is set aside when a workspace's contents take
// over the local mirror, so disconnecting can hand those notes back instead of
// a copy of the workspace.
export const LOCAL_NOTES_BACKUP_KEY = "scratchpad_local_notes";

export function persistNotesLocally(storage, notes) {
  try {
    storage.setItem(LOCAL_NOTES_KEY, JSON.stringify(notes));
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error };
  }
}

// Parses a stored note collection, returning null for anything that is missing,
// unreadable, or empty so callers can treat "nothing worth keeping" uniformly.
export function readStoredNotes(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch (error) {
    return null;
  }
}
