// SPDX-License-Identifier: GPL-3.0-or-later
// Only the editor primitives Scratchpad uses are bundled for offline loading.
export { Compartment, EditorSelection, EditorState, StateEffect, StateField, Transaction } from "@codemirror/state";
export { Decoration, EditorView, GutterMarker, drawSelection, dropCursor, gutter, keymap, lineNumbers, placeholder } from "@codemirror/view";
export { standardKeymap, history, historyKeymap, insertNewline, isolateHistory, redo, undo } from "@codemirror/commands";
export { codeFolding, foldEffect, foldGutter, foldKeymap, foldedRanges, foldService, unfoldEffect } from "@codemirror/language";
export { parser as markdownParser } from "@lezer/markdown";
export { parser as jsonParser } from "@lezer/json";
export { parser as xmlParser } from "@lezer/xml";
export { parser as yamlParser } from "@lezer/yaml";
