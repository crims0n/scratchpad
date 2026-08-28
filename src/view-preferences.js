// SPDX-License-Identifier: GPL-3.0-or-later

export const DEFAULT_EDITOR_ZOOM = 1;
export const MIN_EDITOR_ZOOM = 0.5;
export const MAX_EDITOR_ZOOM = 2;
export const EDITOR_ZOOM_STEP = 0.1;

export const DEFAULT_EDITOR_LINE_SPACING = 1.6;
export const MIN_EDITOR_LINE_SPACING = 1.2;
export const MAX_EDITOR_LINE_SPACING = 2.4;
export const EDITOR_LINE_SPACING_STEP = 0.1;

export const DEFAULT_NOTE_PREVIEW_LINES = 2;
export const MIN_NOTE_PREVIEW_LINES = 1;
export const MAX_NOTE_PREVIEW_LINES = 10;

function normalizeSteppedValue(value, fallback, minimum, maximum) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(numericValue * 10) / 10));
}

export function normalizeEditorZoom(value) {
  return normalizeSteppedValue(value, DEFAULT_EDITOR_ZOOM, MIN_EDITOR_ZOOM, MAX_EDITOR_ZOOM);
}

export function normalizeEditorLineSpacing(value) {
  return normalizeSteppedValue(
    value,
    DEFAULT_EDITOR_LINE_SPACING,
    MIN_EDITOR_LINE_SPACING,
    MAX_EDITOR_LINE_SPACING
  );
}

export function stepEditorZoom(value, direction) {
  return normalizeEditorZoom(normalizeEditorZoom(value) + direction * EDITOR_ZOOM_STEP);
}

export function stepEditorLineSpacing(value, direction) {
  return normalizeEditorLineSpacing(
    normalizeEditorLineSpacing(value) + direction * EDITOR_LINE_SPACING_STEP
  );
}

export function normalizeNotePreviewLines(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return DEFAULT_NOTE_PREVIEW_LINES;
  return Math.min(
    MAX_NOTE_PREVIEW_LINES,
    Math.max(MIN_NOTE_PREVIEW_LINES, Math.round(numericValue))
  );
}

export function stepNotePreviewLines(value, direction) {
  return normalizeNotePreviewLines(normalizeNotePreviewLines(value) + direction);
}
