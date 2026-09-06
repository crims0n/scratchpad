// SPDX-License-Identifier: GPL-3.0-or-later

import { isFolderNameAvailable, normalizeFolderName, validFolderId } from "./folders.js";
import { insertNoteBelowPinned } from "./note-order.js";

// The adapter shares the editor's persistence queue. Keep creations staged until
// saved, then merge into live state so typing during a disk write is preserved.
export function createMcpWriter(adapter) {
  const receipts = new Map();
  let receiptCollection = null;
  let pendingFolder = null;

  function checkAccess(args, operation) {
    const state = adapter.state();
    if (!state.permissions[operation]) throw new Error("Write access is disabled");
    if (state.switching || args.collectionId !== state.collectionId) {
      throw new Error("Collection changed or is switching; read the current collection before writing");
    }
    return state;
  }

  async function request(operation, args) {
    if (!["create_note", "create_folder", "append_to_note", "rename_note", "move_note", "rename_folder", "delete_note", "delete_folder"].includes(operation)) throw new Error("Unknown write operation");
    const state = checkAccess(args, operation);
    if (receiptCollection !== state.collectionId) {
      receipts.clear();
      receiptCollection = state.collectionId;
    }
    if (typeof args.requestId !== "string" || !args.requestId.trim() || [...args.requestId].length > 128) {
      throw new Error("requestId must contain 1-128 characters");
    }
    const appending = operation === "append_to_note";
    const deleting = operation === "delete_note" || operation === "delete_folder";
    const changingFolder = operation === "rename_folder" || operation === "delete_folder";
    const changingNote = ["append_to_note", "rename_note", "move_note"].includes(operation);
    const editing = changingNote || changingFolder || deleting;
    const validText = (text, max = 200) => typeof text === "string" && text.trim() && [...text.trim()].length <= max;
    if (["create_note", "rename_note"].includes(operation) && !validText(args.title)
      || ["create_folder", "rename_folder"].includes(operation) && !validText(args.name)) {
      throw new Error("Title or name must contain 1-200 characters");
    }
    const content = args.content ?? "";
    if (typeof content !== "string" || new TextEncoder().encode(content).length > 100_000) {
      throw new Error("Content must contain at most 100000 UTF-8 bytes");
    }
    if (editing && (!validText(changingFolder ? args.folderId : args.noteId) || !validText(args.expectedRevision, 128))) {
      throw new Error("Editing requires an existing ID and an expectedRevision from get_note or list_folders");
    }
    if (appending && !content.length) throw new Error("Appending requires nonempty content");
    if (operation === "move_note" && args.folderId !== null && !validText(args.folderId)) {
      throw new Error("Moving requires folderId: an existing folder ID or null for top level");
    }
    const fingerprint = JSON.stringify([operation, args.noteId ?? null, args.title ?? null, args.name ?? null,
      content, args.folderId ?? null, args.expectedRevision ?? null]);
    let receipt = receipts.get(args.requestId);
    if (receipt && receipt.fingerprint !== fingerprint) throw new Error("requestId was already used with different arguments");
    if (!receipt) {
      // Never evict successful keys: doing so could turn a retry into a duplicate.
      if (receipts.size >= 1000) throw new Error("Write limit reached for this collection session; reopen the collection to start a new session");
      receipt = { fingerprint };
      receipts.set(args.requestId, receipt);
    }
    if (!receipt.promise) {
      receipt.promise = adapter.enqueue(async () => {
        const current = checkAccess(args, operation);
        if (deleting) {
          if (!receipt.applied) {
            const item = (changingFolder ? current.folders : current.notes).find(item => item.id === (changingFolder ? args.folderId : args.noteId));
            if (!item) throw new Error(`${changingFolder ? "Folder" : "Note"} no longer exists`);
            if ((changingFolder ? adapter.folderRevision(item) : adapter.revision(item)) !== args.expectedRevision) {
              throw new Error("Revision conflict: reread the target before deleting");
            }
            if (changingFolder) {
              if (current.notes.some(note => note.folderId === item.id)) throw new Error("Folder is not empty; move its notes before deleting it");
              adapter.applyFolderDeletion(item);
              receipt.result = { folderId: item.id };
            } else {
              receipt.result = { trash: adapter.applyNoteDeletion(item) };
            }
            receipt.applied = true;
          }
          try {
            await adapter.persist(adapter.state(), operation);
          } catch (error) {
            adapter.mutationSaveFailed();
            throw new Error(`Deletion applied in the editor but save failed; retry identical arguments with the same requestId: ${error.message || error}`);
          }
          adapter.deletionSaved();
          return { ok: true, collectionId: args.collectionId, requestId: args.requestId, ...receipt.result };
        }
        if (editing) {
          let item = (changingFolder ? current.folders : current.notes).find(item => item.id === (changingFolder ? args.folderId : args.noteId));
          if (!item) throw new Error(`${changingFolder ? "Folder" : "Note"} no longer exists; write will not be repeated`);
          const revisionOf = changingFolder ? adapter.folderRevision : adapter.revision;
          if (!receipt.applied) {
            if (revisionOf(item) !== args.expectedRevision) {
              throw new Error(`Revision conflict: reread with ${changingFolder ? "list_folders" : "get_note"} before editing`);
            }
            if (changingFolder) {
              if (current.editingFolderId === item.id) throw new Error("Folder is being edited; retry after the editor finishes");
              const name = normalizeFolderName(args.name);
              if (!isFolderNameAvailable(current.folders, name, item.id)) throw new Error("Folder name is reserved or already exists");
              item = { ...item, name };
              adapter.applyFolderChange(item);
            } else {
              if (operation === "move_note" && args.folderId !== null && !validFolderId(args.folderId, current.folders)) {
                throw new Error("Destination folder does not exist");
              }
              item = { ...item, updatedAt: Math.max(Date.now(), item.updatedAt + 1),
                ...(appending ? { content: item.content + content }
                  : operation === "rename_note" ? { title: args.title.trim(), isTitleLocked: true }
                    : { folderId: args.folderId }) };
              // Apply before yielding so subsequent user edits build on this change.
              adapter.applyNoteChange(item, operation);
            }
            receipt.applied = true;
          }
          const candidate = adapter.state();
          const savedItem = structuredClone((changingFolder ? candidate.folders : candidate.notes).find(existing => existing.id === item.id));
          const revision = revisionOf(savedItem);
          try {
            await adapter.persist(candidate, operation);
          } catch (error) {
            adapter.mutationSaveFailed();
            throw new Error(`${appending ? "Append" : "Change"} applied in the editor but save failed; retry the same requestId to save without applying again: ${error.message || error}`);
          }
          adapter.mutationSaved(savedItem.id, revision, operation);
          const metadata = { ...savedItem };
          delete metadata.content;
          return { ok: true, collectionId: args.collectionId, requestId: args.requestId,
            [changingFolder ? "folder" : "note"]: metadata, revision };
        }
        let note;
        let folder;
        if (operation === "create_note") {
          const folderId = args.folderId ?? null;
          if (folderId !== null && !validFolderId(folderId, current.folders)) throw new Error("Destination folder does not exist");
          note = {
            id: `note_${adapter.uuid()}`, title: args.title.trim(), content,
            updatedAt: Date.now(), isTitleLocked: true, isPinned: false, folderId
          };
        } else {
          const name = normalizeFolderName(args.name);
          if (!isFolderNameAvailable(current.folders, name)) throw new Error("Folder name is reserved or already exists");
          folder = { id: `folder_${adapter.uuid()}`, name };
          pendingFolder = folder;
        }
        try {
          await adapter.persist({
            ...current,
            notes: note ? insertNoteBelowPinned(current.notes, note) : current.notes,
            folders: folder ? [...current.folders, folder] : current.folders
          }, operation);
          // Publication is synchronous and occurs before the next queued save.
          // The adapter merges with the latest editor state, never the old copy.
          adapter.publish({ note, folder });
          return structuredClone({ ok: true, collectionId: args.collectionId, requestId: args.requestId,
            ...(note ? { note } : { folder }) });
        } finally {
          pendingFolder = null;
        }
      });
      receipt.promise.catch(() => {
        if (receipt.applied) {
          // Keep the receipt after a failed save: the change is already in live
          // state and a retry must persist that state without applying it again.
          receipt.promise = null;
        } else if (receipts.get(args.requestId) === receipt) {
          receipts.delete(args.requestId);
        }
      });
    }
    const result = await receipt.promise;
    // A saved result remains deduplicated even if refreshing the MCP view fails.
    try {
      await adapter.refresh();
    } catch (error) {
      throw new Error(`Write saved, but MCP refresh failed; retry with the same requestId: ${error.message || error}`);
    }
    return result;
  }

  return { request, reservedFolders: () => pendingFolder ? [pendingFolder] : [] };
}

// Opaque tokens describe the whole live note, including unsaved content and
// metadata. Calculating synchronously lets conflict checking and mutation happen
// in the same JS turn, without a hashing await that could race another edit.
export function createNoteRevisionTracker(uuid) {
  const revisions = new Map();
  let collection = null;
  return (note, collectionId) => {
    if (collection !== collectionId) {
      revisions.clear();
      collection = collectionId;
    }
    const fingerprint = JSON.stringify([
      note.title, note.content, note.updatedAt, Boolean(note.isTitleLocked),
      Boolean(note.isPinned), note.folderId ?? null
    ]);
    let entry = revisions.get(note.id);
    if (!entry || entry.fingerprint !== fingerprint) {
      entry = { fingerprint, token: uuid() };
      revisions.set(note.id, entry);
    }
    return entry.token;
  };
}

// Folder revisions track names, not membership: moving notes does not rename a folder.
export function createFolderRevisionTracker(uuid) {
  const track = createNoteRevisionTracker(uuid);
  return (folder, collectionId) => track({ id: folder.id, title: folder.name }, collectionId);
}
