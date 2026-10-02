// SPDX-License-Identifier: GPL-3.0-or-later
// Only the editor primitives Scratchpad uses are bundled for offline loading.
export { Compartment, EditorSelection, EditorState, StateEffect, StateField, Transaction } from "@codemirror/state";
export { Decoration, EditorView, GutterMarker, drawSelection, dropCursor, gutter, keymap, lineNumbers, placeholder } from "@codemirror/view";
export { standardKeymap, history, historyKeymap, insertNewline, isolateHistory, redo, undo } from "@codemirror/commands";
