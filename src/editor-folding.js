// SPDX-License-Identifier: GPL-3.0-or-later

import {
  EditorState, StateEffect, StateField, codeFolding, foldEffect, foldGutter,
  foldKeymap, foldedRanges, foldService, jsonParser, keymap, markdownParser,
  unfoldEffect, xmlParser, yamlParser
} from "./vendor/codemirror.js";

const parsers = { MD: markdownParser, JSON: jsonParser, XML: xmlParser, YAML: yamlParser };
export const foldingFormatEffect = StateEffect.define();
// Bound synchronous parsing until folding uses incremental language support.
export const MAX_FOLD_CHARACTERS = 100_000;
export const MAX_FOLD_LINES = 2_000;

export function canFoldDocument(doc, format) {
  return Boolean(parsers[format]) && doc.length <= MAX_FOLD_CHARACTERS && doc.lines <= MAX_FOLD_LINES;
}

function tagName(node, source) {
  const name = node?.getChild("TagName");
  return name ? source.sliceString(name.from, name.to) : null;
}

// Parse source, rather than counting delimiters/indentation inside strings,
// comments, fenced code, or scalar blocks. Only complete, multiline boundaries
// become candidates. Each gutter line offers its outermost candidate.
export function getFormatFoldRanges(source, format) {
  const parser = parsers[format];
  if (!parser || source.length > MAX_FOLD_CHARACTERS) return [];
  const doc = typeof source === "string" ? EditorState.create({ doc: source }).doc : source;
  if (!canFoldDocument(doc, format)) return [];
  const tree = parser.parse(doc.toString());
  const nodes = [], errors = [];
  tree.iterate({ enter(ref) {
    const node = ref.node;
    nodes.push(node);
    if (node.type.isError) errors.push({ from: node.from, to: node.to });
    if (format === "XML" && node.name === "Element") {
      const open = node.getChild("OpenTag"), close = node.getChild("CloseTag");
      if (open && (!close || tagName(open, doc) !== tagName(close, doc))) {
        errors.push({ from: node.from, to: node.to });
      }
    }
  } });
  const ranges = [];
  function add(from, to, node) {
    if (from >= to || doc.lineAt(from).number === doc.lineAt(to).number) return;
    if (errors.some(error => error.from <= node.to && error.to >= node.from)) return;
    ranges.push({ from, to });
  }
  for (const node of nodes) {
    if (format === "JSON" && (node.name === "Object" || node.name === "Array")) {
      const open = node.firstChild, close = node.lastChild;
      if (open?.name === (node.name === "Object" ? "{" : "[") &&
          close?.name === (node.name === "Object" ? "}" : "]")) add(open.to, close.from, node);
    } else if (format === "XML" && node.name === "Element") {
      const open = node.getChild("OpenTag"), close = node.getChild("CloseTag");
      if (open && close) add(open.to, close.from, node);
    } else if (format === "MD") {
      const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
      if (heading && node.parent) {
        let to = node.parent.to;
        for (let sibling = node.nextSibling; sibling; sibling = sibling.nextSibling) {
          const next = /^(?:ATX|Setext)Heading([1-6])$/.exec(sibling.name);
          if (next && Number(next[1]) <= Number(heading[1])) {
            to = Math.max(node.to, doc.lineAt(sibling.from).from - 1);
            break;
          }
        }
        add(doc.lineAt(node.to).to, to, node);
      } else if (node.name === "FencedCode" && node.getChildren("CodeMark").length === 2) {
        add(doc.lineAt(node.from).to, node.to, node);
      }
    } else if (format === "YAML") {
      if (node.name === "FlowMapping" || node.name === "FlowSequence") {
        const open = node.firstChild, close = node.lastChild;
        if (open?.name === (node.name === "FlowMapping" ? "{" : "[") &&
            close?.name === (node.name === "FlowMapping" ? "}" : "]")) add(open.to, close.from, node);
      } else if (node.name === "BlockLiteral") {
        add(doc.lineAt(node.from).to, node.to, node);
      } else if (node.name === "BlockMapping" || node.name === "BlockSequence") {
        if (node.parent?.name === "Pair" || node.parent?.name === "Item") {
          const header = doc.lineAt(node.parent.from);
          add(header.to, node.to, node);
        }
      }
    }
  }
  ranges.sort((a, b) => a.from - b.from || b.to - a.to);
  const lines = new Set();
  return ranges.filter(range => {
    const line = doc.lineAt(range.from).number;
    if (lines.has(line)) return false;
    lines.add(line);
    return true;
  });
}

function candidates(doc, format) {
  const ranges = getFormatFoldRanges(doc, format);
  return {
    format, byRange: new Set(ranges.map(range => `${range.from}:${range.to}`)),
    byLine: new Map(ranges.map(range => [doc.lineAt(range.from).from, range]))
  };
}
const foldingCandidates = StateField.define({
  create: state => candidates(state.doc, "TXT"),
  update(value, transaction) {
    let format = value.format;
    for (const effect of transaction.effects) {
      if (effect.is(foldingFormatEffect)) format = effect.value;
    }
    return transaction.docChanged || format !== value.format ? candidates(transaction.newDoc, format) : value;
  }
});

export function getEditorFolds(state) {
  const ranges = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => { ranges.push({ from, to }); });
  return ranges;
}

export function getEditorFoldAtLine(state, lineNumber) {
  return state.field(foldingCandidates).byLine.get(state.doc.line(lineNumber).from) ?? null;
}

export function revealFoldedRange(view, start, end) {
  const effects = getEditorFolds(view.state)
    .filter(range => range.from < end && range.to > start || start === end && range.from < start && range.to > start)
    .map(range => unfoldEffect.of(range));
  if (effects.length) view.dispatch({ effects });
}

export function editorFolding() {
  return [
    foldingCandidates,
    foldService.of((state, from) => state.field(foldingCandidates).byLine.get(from) ?? null),
    codeFolding({
      preparePlaceholder: (state, range) => state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number,
      placeholderDOM(view, onclick, count) {
        const button = view.dom.ownerDocument.createElement("button");
        button.type = "button";
        button.className = "cm-foldPlaceholder";
        button.textContent = `… ${count} line${count === 1 ? "" : "s"}`;
        button.title = button.ariaLabel = `Expand ${count} hidden line${count === 1 ? "" : "s"}`;
        button.onclick = onclick;
        button.onkeydown = event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); };
        return button;
      }
    }),
    keymap.of(foldKeymap),
    // CodeMirror maps folds through edits. Check those mapped boundaries against
    // the newly parsed source in the same transaction, so invalid folds never
    // linger while the application's syntax-color redraw is debounced.
    EditorState.transactionExtender.of(transaction => {
      if (!transaction.docChanged && !transaction.effects.some(effect => effect.is(foldingFormatEffect))) return null;
      const valid = transaction.state.field(foldingCandidates).byRange;
      const effects = [];
      for (const range of getEditorFolds(transaction.state)) {
        if (!valid.has(`${range.from}:${range.to}`)) {
          effects.push(unfoldEffect.of(range));
        } else if (transaction.docChanged) {
          // Recreate the widget to update its hidden-line count.
          effects.push(unfoldEffect.of(range), foldEffect.of(range));
        }
      }
      return effects.length ? { effects } : null;
    })
  ];
}

export function editorFoldGutter() {
  return foldGutter({
    markerDOM(open) {
      // CodeMirror hides gutters from assistive technology. Keep markers out of
      // the tab order; keyboard folding uses foldKeymap, and the placeholder is
      // a focusable expansion button within the document.
      const marker = document.createElement("span");
      marker.className = "editor-fold-toggle";
      marker.textContent = open ? "⌄" : "›";
      marker.title = open ? "Collapse section" : "Expand section";
      marker.setAttribute("data-expanded", String(open));
      return marker;
    },
    foldingChanged: update => update.startState.field(foldingCandidates) !== update.state.field(foldingCandidates)
  });
}
