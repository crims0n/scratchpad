// SPDX-License-Identifier: GPL-3.0-or-later

export const PINNED_SECTION_ID = "__pinned__";
export const UNFILED_SECTION_ID = "__unfiled__";
const RESERVED_FOLDER_NAMES = new Set(["pinned", "top level"]);

export function normalizeFolders(value) {
  if (!Array.isArray(value)) return [];

  const seenIds = new Set();
  const folders = [];

  value.forEach((folder) => {
    const id = typeof folder?.id === "string" ? folder.id.trim() : "";
    const name = typeof folder?.name === "string" ? folder.name.trim() : "";
    if (
      !id ||
      id === PINNED_SECTION_ID ||
      id === UNFILED_SECTION_ID ||
      !name ||
      seenIds.has(id)
    ) return;

    seenIds.add(id);
    folders.push({ id, name });
  });

  return folders;
}

export function normalizeFolderName(name) {
  return typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
}

export function isReservedFolderName(name) {
  return RESERVED_FOLDER_NAMES.has(normalizeFolderName(name).toLocaleLowerCase());
}

export function isFolderNameAvailable(folders, name, excludedId = null) {
  const normalizedName = normalizeFolderName(name).toLocaleLowerCase();
  if (!normalizedName || RESERVED_FOLDER_NAMES.has(normalizedName)) return false;
  return !folders.some((folder) => (
    folder.id !== excludedId && folder.name.toLocaleLowerCase() === normalizedName
  ));
}

export function validFolderId(folderId, folders) {
  return folders.some((folder) => folder.id === folderId) ? folderId : null;
}

export function noteSectionId(note, folders) {
  if (note?.isPinned === true) return PINNED_SECTION_ID;
  return validFolderId(note?.folderId, folders) || UNFILED_SECTION_ID;
}

export function normalizeNoteFolderAssignments(notes, folders) {
  return notes.map((note) => (
    note?.folderId != null && !validFolderId(note.folderId, folders)
      ? { ...note, folderId: null }
      : note
  ));
}

export function moveFolder(folders, folderId, offset) {
  const index = folders.findIndex((folder) => folder.id === folderId);
  const targetIndex = index + offset;
  if (index < 0 || targetIndex < 0 || targetIndex >= folders.length) return folders;

  const updated = [...folders];
  const [folder] = updated.splice(index, 1);
  updated.splice(targetIndex, 0, folder);
  return updated;
}

export function removeFolder(folders, notes, folderId) {
  if (!folders.some((folder) => folder.id === folderId)) return { folders, notes };
  return {
    folders: folders.filter((folder) => folder.id !== folderId),
    notes: notes.map((note) => (
      note.folderId === folderId ? { ...note, folderId: null } : note
    ))
  };
}
