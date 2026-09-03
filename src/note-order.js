// SPDX-License-Identifier: GPL-3.0-or-later

export function isNotePinned(note) {
  return note?.isPinned === true;
}

export function normalizePinnedNoteOrder(notes) {
  return [
    ...notes.filter(isNotePinned),
    ...notes.filter(note => !isNotePinned(note))
  ];
}

export function insertNoteBelowPinned(notes, note) {
  const firstUnpinnedIndex = notes.findIndex(existingNote => !isNotePinned(existingNote));
  const insertIndex = firstUnpinnedIndex === -1 ? notes.length : firstUnpinnedIndex;
  return [...notes.slice(0, insertIndex), note, ...notes.slice(insertIndex)];
}

export function setNotePinned(notes, noteId, pinned) {
  const noteIndex = notes.findIndex(note => note.id === noteId);
  if (noteIndex === -1) return notes;

  const updatedNote = { ...notes[noteIndex], isPinned: pinned };
  const remainingNotes = notes.filter((_, index) => index !== noteIndex);
  if (pinned) return [updatedNote, ...remainingNotes];

  return insertNoteBelowPinned(remainingNotes, updatedNote);
}

export function canMoveNote(notes, noteIndex, offset) {
  return getNoteMoveTargetIndex(notes, noteIndex, offset) !== -1;
}

function noteOrderGroup(note) {
  if (isNotePinned(note)) return "__pinned__";
  return typeof note?.folderId === "string" && note.folderId ? note.folderId : "__unfiled__";
}

export function getNoteMoveTargetIndex(notes, noteIndex, offset) {
  if (noteIndex < 0 || noteIndex >= notes.length || ![-1, 1].includes(offset)) return -1;
  const group = noteOrderGroup(notes[noteIndex]);

  for (
    let candidateIndex = noteIndex + offset;
    candidateIndex >= 0 && candidateIndex < notes.length;
    candidateIndex += offset
  ) {
    if (noteOrderGroup(notes[candidateIndex]) === group) return candidateIndex;
  }
  return -1;
}

export function moveNoteInGroup(notes, noteId, offset) {
  const noteIndex = notes.findIndex((note) => note.id === noteId);
  const targetIndex = getNoteMoveTargetIndex(notes, noteIndex, offset);
  if (targetIndex === -1) return notes;

  const updated = [...notes];
  const [note] = updated.splice(noteIndex, 1);
  updated.splice(targetIndex, 0, note);
  return updated;
}
