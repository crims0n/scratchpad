// SPDX-License-Identifier: GPL-3.0-or-later
import { LOCAL_NOTES_KEY, LOCAL_FOLDERS_KEY, parseLocalNotes, parseLocalFolders } from "./storage.js";
import { LOCAL_TRASH_KEY, readTrash } from "./trash.js";

export const COLLECTION_KEYS = [LOCAL_NOTES_KEY, LOCAL_FOLDERS_KEY, LOCAL_TRASH_KEY];
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function validateCollection(value) {
  if (!object(value) || !Array.isArray(value.notes) || !Array.isArray(value.folders) || !Array.isArray(value.trash)) {
    throw new Error("Backup must contain notes, folders, and trash arrays");
  }
  const notes = parseLocalNotes(JSON.stringify(value.notes));
  const folders = parseLocalFolders(JSON.stringify(value.folders));
  const trash = readTrash(JSON.stringify(value.trash));
  const folderIds = new Set(folders.map(folder => folder.id));
  const validateNote = note => {
    parseLocalNotes(JSON.stringify([note]));
    if (!Number.isSafeInteger(note.updatedAt) || note.updatedAt < 0) throw new Error("Invalid note timestamp");
    return { id: note.id, title: note.title, content: note.content, updatedAt: note.updatedAt,
      isTitleLocked: note.isTitleLocked ?? false, isPinned: note.isPinned ?? false, folderId: note.folderId ?? null };
  };
  const cleanNotes = notes.map(note => {
    if (note.folderId != null && !folderIds.has(note.folderId)) throw new Error("A note references a missing folder");
    return validateNote(note);
  });
  const cleanTrash = trash.map(entry => {
    if (!Number.isSafeInteger(entry.deletedAt) || entry.deletedAt < 0
      || (entry.folderName != null && typeof entry.folderName !== "string")) throw new Error("Invalid trash metadata");
    // Deleted notes can refer to folders that no longer exist. Retain that metadata.
    return { id: entry.id, note: validateNote(entry.note), deletedAt: entry.deletedAt, folderName: entry.folderName ?? null };
  });
  return { notes: cleanNotes, folders: folders.map(({ id, name }) => ({ id, name })), trash: cleanTrash };
}

export function serializeBackup(collection, now = new Date()) {
  return JSON.stringify({ schemaVersion: 1, kind: "scratchpad-collection-backup", createdAt: now.toISOString(),
    collection: validateCollection(collection) }, null, 2);
}

export function parseBackup(content) {
  const value = JSON.parse(content);
  if (!object(value) || value.kind !== "scratchpad-collection-backup") throw new Error("Not a Scratchpad collection backup");
  if (value.schemaVersion !== 1) throw new Error("Unsupported collection backup version");
  if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) throw new Error("Invalid backup date");
  return validateCollection(value.collection);
}

export function readLocalValues(storage) {
  return Object.fromEntries(COLLECTION_KEYS.map(key => [key, storage.getItem(key)]));
}

export function restoreLocalValues(storage, values) {
  if (!object(values) || Object.keys(values).length !== COLLECTION_KEYS.length
    || COLLECTION_KEYS.some(key => !(key in values) || (values[key] !== null && typeof values[key] !== "string"))) {
    throw new Error("Unreadable local restore checkpoint; no data was changed");
  }
  for (const key of COLLECTION_KEYS) {
    if (values[key] === null) storage.removeItem(key);
    else storage.setItem(key, values[key]);
  }
  if (COLLECTION_KEYS.some(key => storage.getItem(key) !== values[key])) throw new Error("Local restore verification failed");
}

// A verified native checkpoint survives app termination, quota errors, and failed rollback.
// Callers must lock editing/autosave until this completes, and remain read-only if recovery fails.
export async function replaceLocalCollection(storage, collection, journal, safetyContent) {
  const candidate = validateCollection(collection);
  const before = readLocalValues(storage);
  await journal.begin(before, safetyContent);
  try {
    restoreLocalValues(storage, { [LOCAL_NOTES_KEY]: JSON.stringify(candidate.notes),
      [LOCAL_FOLDERS_KEY]: JSON.stringify(candidate.folders), [LOCAL_TRASH_KEY]: JSON.stringify(candidate.trash) });
  } catch (error) {
    try {
      restoreLocalValues(storage, before);
      await journal.complete();
    } catch (rollbackError) {
      throw new Error(`Restore failed; local collection is read-only until checkpoint recovery succeeds: ${rollbackError.message || rollbackError}`);
    }
    throw error;
  }
  // Finalization can fail *after* removing the marker (e.g. directory sync).
  // Do not start an unjournaled rollback. Let recovery inspect the actual marker
  // and reload the authoritative values before permitting further edits.
  try {
    await journal.complete();
  } catch (error) {
    throw new Error(`New collection was written, but checkpoint finalization failed: ${error.message || error}`);
  }
}

export async function recoverLocalRestore(storage, journal) {
  const values = await journal.read();
  if (values == null) return false;
  restoreLocalValues(storage, values);
  await journal.complete();
  return true;
}
