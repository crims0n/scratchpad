// SPDX-License-Identifier: GPL-3.0-or-later

export const LOCAL_NOTES_KEY = "scratchpad_notes";
export const LOCAL_FOLDERS_KEY = "scratchpad_folders";

// Used by earlier builds of this branch to set notes aside while local storage
// was shared between the local-only collection and the active workspace. Read
// once at start-up so nothing is stranded; never written to.
export const LOCAL_NOTES_BACKUP_KEY = "scratchpad_local_notes";
export const LOCAL_RECOVERY_KEY = "scratchpad_local_recovery";

// Unlike the legacy readers below, these distinguish missing/empty collections
// from damaged data. Never normalize away records before validating them.
export function parseLocalNotes(raw) {
  const value = raw === null ? [] : JSON.parse(raw);
  if (!Array.isArray(value) || value.some(note => !note || typeof note !== "object"
    || typeof note.id !== "string" || !note.id.trim()
    || typeof note.title !== "string" || typeof note.content !== "string"
    || !Number.isFinite(note.updatedAt)
    || (note.isPinned !== undefined && typeof note.isPinned !== "boolean")
    || (note.isTitleLocked !== undefined && typeof note.isTitleLocked !== "boolean")
    || (note.folderId != null && (typeof note.folderId !== "string" || !note.folderId.trim())))
    || new Set(value.map(note => note.id)).size !== value.length) {
    throw new Error("Saved notes have an invalid structure");
  }
  return value;
}

export function parseLocalFolders(raw) {
  const value = raw === null ? [] : JSON.parse(raw);
  if (!Array.isArray(value) || value.some(folder => !folder || typeof folder !== "object"
    || typeof folder.id !== "string" || !folder.id.trim() || folder.id !== folder.id.trim()
    || ["__pinned__", "__unfiled__"].includes(folder.id)
    || typeof folder.name !== "string" || !folder.name.trim())
    || new Set(value.map(folder => folder.id)).size !== value.length) {
    throw new Error("Saved folders have an invalid structure");
  }
  return value;
}

// All local collection writes use this adapter, including trash, legacy
// adoption, MCP, and page-exit saves. A failed load locks the whole collection:
// saving healthy notes must not destroy their unreadable folder metadata.
export function createLocalCollectionStorage(storage, archive = null) {
  let loaded = false;
  let archiveAvailable = false;
  let snapshot = { notes: [], folders: [], raw: {}, errors: {}, readFailures: [] };
  const blocked = () => !loaded || Object.keys(snapshot.errors).length > 0;
  const guarded = {
    getItem: key => storage.getItem(key),
    setItem(key, value) {
      if (blocked()) throw new Error("Local collection needs recovery; saved data has not been replaced");
      storage.setItem(key, value);
    }
  };

  function load() {
    const next = { notes: [], folders: [], raw: {}, errors: {}, readFailures: [] };
    for (const [key, field, parse] of [[LOCAL_NOTES_KEY, "notes", parseLocalNotes], [LOCAL_FOLDERS_KEY, "folders", parseLocalFolders]]) {
      try {
        next.raw[key] = storage.getItem(key);
      } catch (error) {
        next.readFailures.push(key);
        next.errors[key] = String(error.message || error);
        continue;
      }
      try {
        next[field] = parse(next.raw[key]);
      } catch (error) {
        next.errors[key] = String(error.message || error);
      }
    }
    snapshot = next;
    loaded = true;
    return snapshot;
  }

  function recoverySnapshot() {
    return {
      schemaVersion: 1, kind: "scratchpad-local-recovery", capturedAt: new Date().toISOString(),
      // Raw strings are deliberate: malformed JSON must survive byte-for-byte.
      values: { ...snapshot.raw, scratchpad_trash: storage.getItem("scratchpad_trash"),
        [LOCAL_NOTES_BACKUP_KEY]: storage.getItem(LOCAL_NOTES_BACKUP_KEY) },
      errors: snapshot.errors, unreadableKeys: snapshot.readFailures,
      // One-time compatibility with recovery copies made by earlier builds.
      // New archives never embed another native archive.
      legacyRecovery: storage.getItem(LOCAL_RECOVERY_KEY)
    };
  }

  async function refreshArchives() {
    archiveAvailable = archive ? await archive.hasCopies() : false;
  }

  async function recoveryData() {
    const copies = archive ? await archive.readCopies() : [];
    archiveAvailable = copies.length > 0;
    const current = blocked() ? recoverySnapshot() : null;
    const legacy = !blocked() ? storage.getItem(LOCAL_RECOVERY_KEY) : null;
    if (!current && !legacy && !copies.length) throw new Error("There is no preserved recovery data to export");
    return JSON.stringify({ schemaVersion: 2, kind: "scratchpad-local-recovery-export",
      current, legacyRecovery: legacy, preservedCopies: copies }, null, 2);
  }

  async function replaceUnreadable(checkCurrent = () => {}) {
    if (!loaded || !blocked()) return load();
    if (snapshot.readFailures.length) throw new Error("Storage could not be read; retry reading before replacing data");
    if (!archive) throw new Error("Automatic replacement requires the desktop app; export preserved data for manual recovery");
    const source = snapshot;
    const checkSource = () => {
      checkCurrent();
      for (const key of [LOCAL_NOTES_KEY, LOCAL_FOLDERS_KEY]) {
        if (snapshot !== source || storage.getItem(key) !== source.raw[key]) {
          throw new Error("Local data changed; retry reading before replacing data");
        }
      }
    };
    checkSource();
    const copy = recoverySnapshot();
    // The adapter must durably save and verify an independent copy outside
    // localStorage before returning. Do not write a large archive or even a
    // pointer into the already quota-constrained source storage.
    const preservedPath = await archive.saveCopy(JSON.stringify(copy, null, 2));
    if (typeof preservedPath !== "string" || !preservedPath.trim()) {
      throw new Error("Recovery archive did not confirm a preserved file; data remains protected");
    }
    archiveAvailable = true;
    checkSource(); // Reads/switches/close requests may race the asynchronous save.
    for (const key of Object.keys(source.errors)) storage.setItem(key, "[]");
    // The legacy copy is now in the verified native file, so it no longer needs
    // to occupy webview quota. Never remove a legacy value changed meanwhile.
    if (copy.legacyRecovery !== null && storage.getItem(LOCAL_RECOVERY_KEY) === copy.legacyRecovery) {
      storage.removeItem(LOCAL_RECOVERY_KEY);
    }
    return load();
  }

  return { storage: guarded, load, blocked, recoveryData, replaceUnreadable, refreshArchives,
    canReplace: () => Boolean(archive),
    hasArchive: () => {
      try { return archiveAvailable || storage.getItem(LOCAL_RECOVERY_KEY) !== null; } catch { return archiveAvailable; }
    } };
}

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
