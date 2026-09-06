// SPDX-License-Identifier: GPL-3.0-or-later
import { LOCAL_NOTES_KEY } from "./storage.js";
import { validFolderId } from "./folders.js";

export const LOCAL_TRASH_KEY = "scratchpad_trash";

// Fail closed on unreadable recovery data: never overwrite it with an empty list.
export function readTrash(raw) {
  const entries = JSON.parse(raw || "[]");
  if (!Array.isArray(entries) || entries.some(entry => !entry || typeof entry.id !== "string" || !entry.id.trim()
    || !entry.note || typeof entry.note.id !== "string" || typeof entry.note.content !== "string"
    || typeof entry.note.title !== "string" || !Number.isFinite(entry.note.updatedAt) || !Number.isFinite(entry.deletedAt))
    || new Set(entries.map(entry => entry.id)).size !== entries.length) {
    throw new Error("Trash data is unreadable");
  }
  return entries;
}

export function trashSummary(entry) {
  return { id: entry.id, noteId: entry.note.id, title: entry.note.title,
    deletedAt: entry.deletedAt, folderId: entry.note.folderId ?? null, folderName: entry.folderName ?? null };
}

export function restoredNote(entry, notes, folders) {
  if (notes.some(note => note.id === entry.note.id)) throw new Error("A note with this ID already exists; restore cannot overwrite it");
  return { ...entry.note, updatedAt: Math.max(Date.now(), entry.note.updatedAt + 1), folderId: validFolderId(entry.note.folderId, folders) };
}

// localStorage has no multi-key transaction. Keep both old and new recovery
// copies until active notes are saved. A crash can leave a duplicate recovery
// copy, but cannot destroy the only copy of a deleted or restored note.
export function persistNotesAndTrashLocally(storage, notes, trash) {
  try {
    const old = readTrash(storage.getItem(LOCAL_TRASH_KEY));
    const recovery = [...new Map([...old, ...trash].map(entry => [entry.id, entry])).values()];
    storage.setItem(LOCAL_TRASH_KEY, JSON.stringify(recovery));
    storage.setItem(LOCAL_NOTES_KEY, JSON.stringify(notes));
    storage.setItem(LOCAL_TRASH_KEY, JSON.stringify(trash));
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error };
  }
}

// Only the confirmed UI purge uses this path. Drop the selected recovery copies
// first so Empty Trash can free space even after a quota failure. A partial
// failure may leave an old active copy on disk, but never removes unselected
// recovery copies before saving their replacements.
export function emptyTrashLocally(storage, notes, remainingTrash) {
  try {
    readTrash(storage.getItem(LOCAL_TRASH_KEY));
    storage.setItem(LOCAL_TRASH_KEY, JSON.stringify(remainingTrash));
    storage.setItem(LOCAL_NOTES_KEY, JSON.stringify(notes));
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error };
  }
}
