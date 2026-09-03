// SPDX-License-Identifier: GPL-3.0-or-later

export const LOCAL_NOTES_KEY = "scratchpad_notes";
export const LOCAL_FOLDERS_KEY = "scratchpad_folders";

// Used by earlier builds of this branch to set notes aside while local storage
// was shared between the local-only collection and the active workspace. Read
// once at start-up so nothing is stranded; never written to.
export const LOCAL_NOTES_BACKUP_KEY = "scratchpad_local_notes";

export function persistNotesLocally(storage, notes) {
  try {
    storage.setItem(LOCAL_NOTES_KEY, JSON.stringify(notes));
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error };
  }
}

export function persistFoldersLocally(storage, folders) {
  try {
    storage.setItem(LOCAL_FOLDERS_KEY, JSON.stringify(folders));
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

export function readStoredFolders(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}
