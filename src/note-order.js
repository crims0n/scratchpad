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
  const targetIndex = noteIndex + offset;
  if (noteIndex < 0 || targetIndex < 0 || targetIndex >= notes.length) return false;
  return isNotePinned(notes[noteIndex]) === isNotePinned(notes[targetIndex]);
}
