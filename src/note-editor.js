// SPDX-License-Identifier: GPL-3.0-or-later

import {
  Compartment, Decoration, EditorSelection, EditorState, EditorView,
  GutterMarker, StateEffect, StateField, Transaction,
  standardKeymap, drawSelection, dropCursor, gutter, history, historyKeymap,
  insertNewline, isolateHistory, keymap, lineNumbers, placeholder as editorPlaceholder, redo, undo
} from "./vendor/codemirror.js";
import { getChangedRange } from "./editor-edit.js";
import { createEditorDecorationBuilder } from "./syntax-highlighting.js";

const editors = new WeakMap();
const presentationEffect = StateEffect.define();
const presentationField = StateField.define({
  create: () => ({ marks: Decoration.none, changedLines: new Set(), changeType: null }),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(presentationEffect)) return effect.value;
    }
    return transaction.docChanged
      ? { marks: value.marks.map(transaction.changes), changedLines: new Set(), changeType: null }
      : value;
  },
  provide: field => EditorView.decorations.from(field, value => value.marks)
});

class ChangeMarker extends GutterMarker {
  constructor(type) { super(); this.elementClass = `editor-line-number-diff-${type}`; }
}
const changeMarkers = { added: new ChangeMarker("added"), removed: new ChangeMarker("removed") };
const comparisonGutter = gutter({
  class: "note-editor-diff-gutter",
  lineMarker(view, line) {
    const presentation = view.state.field(presentationField);
    return presentation.changedLines.has(view.state.doc.lineAt(line.from).number - 1)
      ? changeMarkers[presentation.changeType] ?? null : null;
  },
  lineMarkerChange: update => update.docChanged || update.transactions.some(transaction =>
    transaction.effects.some(effect => effect.is(presentationEffect)))
});

export function getNoteEditor(element) { return editors.get(element); }

// A small source/selection API keeps application features independent of the
// editor engine. CodeMirror's document is the only copy of editable content.
export function createNoteEditor(element, { label, placeholder = "" } = {}) {
  const listeners = new Map();
  const readonlyConfig = new Compartment();
  const placeholderConfig = new Compartment();
  const gutterConfig = new Compartment();
  const buildDecorations = createEditorDecorationBuilder();
  let readOnly = false;
  let placeholderText = placeholder;
  let gutterSettings = "";
  let silent = false;
  let destroyed = false;
  let documentVersion = 0;
  let view;
  function emit(type, event) {
    for (const listener of listeners.get(type) ?? []) {
      listener(event);
      if (event?.defaultPrevented) break;
    }
  }
  const contentAttributes = {
    "aria-label": label, spellcheck: "false", autocorrect: "off",
    autocapitalize: "off", autocomplete: "off", tabindex: "0"
  };
  function extensions() {
    return [
      history(), drawSelection(), dropCursor(), EditorView.lineWrapping,
      EditorState.tabSize.of(4), presentationField,
      readonlyConfig.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
      placeholderConfig.of([editorPlaceholder(placeholderText), EditorView.contentAttributes.of({ "aria-placeholder": placeholderText })]),
      gutterConfig.of([]),
      EditorView.contentAttributes.of(contentAttributes),
      EditorView.domEventHandlers({
        keydown(event) { emit("keydown", event); return event.defaultPrevented; },
        paste(event) { if (!readOnly) emit("paste", event); return event.defaultPrevented; },
        scroll(event) { emit("scroll", event); },
        mouseup(event) { emit("mouseup", event); },
        keyup(event) { emit("keyup", event); },
        focus(event) { emit("focus", event); }
      }),
      keymap.of([
        { key: "Enter", run: insertNewline, shift: insertNewline },
        ...historyKeymap,
        // Scratchpad's list-move and Enter helpers run before these bindings.
        ...standardKeymap.filter(binding => binding.key !== "Enter")
      ]),
      EditorView.updateListener.of(update => {
        if (update.docChanged) documentVersion += 1;
        if (silent) return;
        if (update.docChanged) emit("input");
        if (update.selectionSet || update.docChanged) emit("select");
      })
    ];
  }
  view = new EditorView({ parent: element, state: EditorState.create({ extensions: extensions() }) });
  const adapter = {
    element,
    get view() { return view; },
    get contentDOM() { return view.contentDOM; },
    get value() { return view.state.doc.toString(); },
    get documentVersion() { return documentVersion; },
    set value(value) { this.loadDocument(value); },
    // Loading a note/collection resets history even when its text is identical.
    // This prevents Undo from copying edits from the previously displayed note.
    loadDocument(value) {
      documentVersion += 1;
      silent = true;
      try {
        gutterSettings = "";
        view.setState(EditorState.create({ doc: String(value ?? ""), extensions: extensions() }));
      } finally { silent = false; }
    },
    get selectionStart() { return view.state.selection.main.from; },
    get selectionEnd() { return view.state.selection.main.to; },
    get selectionDirection() { return view.state.selection.main.anchor > view.state.selection.main.head ? "backward" : "forward"; },
    setSelectionRange(start, end, direction = "forward") {
      const length = view.state.doc.length;
      const to = Math.max(0, Math.min(length, end));
      const from = Math.max(0, Math.min(to, start));
      view.dispatch({ selection: EditorSelection.single(direction === "backward" ? to : from, direction === "backward" ? from : to) });
    },
    applyEdit(edit) {
      if (readOnly) return;
      const change = getChangedRange(this.value, edit.value);
      const direction = this.selectionDirection;
      const start = edit.selectionStart, end = edit.selectionEnd;
      view.dispatch({
        changes: { from: change.start, to: change.previousEnd, insert: change.replacement },
        selection: EditorSelection.single(direction === "backward" ? end : start, direction === "backward" ? start : end),
        annotations: [Transaction.userEvent.of("input.scratchpad"), isolateHistory.of("full")],
        scrollIntoView: true
      });
    },
    undo() { return !readOnly && undo(view); },
    redo() { return !readOnly && redo(view); },
    focus() { view.focus(); },
    select() { this.focus(); this.setSelectionRange(0, view.state.doc.length); },
    get readOnly() { return readOnly; },
    set readOnly(value) {
      if (readOnly === Boolean(value)) return;
      readOnly = Boolean(value);
      view.dispatch({ effects: readonlyConfig.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
    },
    get placeholder() { return placeholderText; },
    set placeholder(value) {
      if (placeholderText === value) return;
      placeholderText = value;
      view.dispatch({ effects: placeholderConfig.reconfigure([editorPlaceholder(value), EditorView.contentAttributes.of({ "aria-placeholder": value })]) });
    },
    get scrollTop() { return view.scrollDOM.scrollTop; },
    set scrollTop(value) { view.scrollDOM.scrollTop = value; },
    get scrollLeft() { return view.scrollDOM.scrollLeft; },
    set scrollLeft(value) { view.scrollDOM.scrollLeft = value; },
    get scrollHeight() { return view.scrollDOM.scrollHeight; },
    get clientHeight() { return view.scrollDOM.clientHeight; },
    scrollToRange(start, end) {
      view.dispatch({ effects: EditorView.scrollIntoView(EditorSelection.range(start, end), { y: "center" }) });
    },
    setPresentation(options = {}) {
      const marks = buildDecorations(this.value, options).map(range => Decoration.mark({
        class: range.className, ...(range.tagName ? { tagName: range.tagName } : {})
      }).range(range.start, range.end));
      const settings = `${Boolean(options.lineNumbers)}:${Boolean(options.compare)}`;
      const effects = [presentationEffect.of({
        marks: Decoration.set(marks, true), changedLines: new Set(options.changedLines ?? []), changeType: options.changeType
      })];
      if (settings !== gutterSettings) {
        gutterSettings = settings;
        effects.push(gutterConfig.reconfigure([
          ...(options.lineNumbers ? [lineNumbers()] : []),
          ...(options.compare ? [comparisonGutter] : [])
        ]));
      }
      view.dispatch({ effects });
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    // Integration tests can dispatch the same DOM keyboard/paste events as the
    // browser; synthetic input is reserved for silent fixture content loads.
    dispatchEvent(event) {
      if (event.type === "input" || event.type === "select") {
        emit(event.type, event); return !event.defaultPrevented;
      }
      return view.contentDOM.dispatchEvent(event);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      view.destroy();
      editors.delete(element);
    }
  };
  editors.set(element, adapter);
  return adapter;
}
