// SPDX-License-Identifier: GPL-3.0-or-later

import {
  LOCAL_NOTES_BACKUP_KEY,
  LOCAL_NOTES_KEY,
  persistNotesLocally,
  readStoredNotes
} from "./storage.js";
import { renderMarkdown, resolveLinkAction, sanitizeMarkdownHtml } from "./markdown.js";
import { getNotePreview } from "./note-preview.js";
import { findTextMatches } from "./find.js";
import { getCursorPosition } from "./editor-position.js";
import { handleEditorTab } from "./editor-indent.js";
import { handleMarkdownAutocomplete } from "./editor-autocomplete.js";
import { handleEditorSmartKeydown, handleMarkdownPaste } from "./editor-smart.js";
import { applyEditorEdit } from "./editor-edit.js";
import { getMarkdownTemplateEdit } from "./markdown-insert.js";
import { highlightPreviewCode, renderEditorBackdrop } from "./syntax-highlighting.js";
import { renderEditorLineNumbers } from "./editor-line-numbers.js";
import { createEditorRenderScheduler } from "./editor-render-scheduler.js";
import { WELCOME_NOTE_CONTENT, WELCOME_NOTE_TITLE } from "./welcome-note.js";
import {
  canMoveNote,
  insertNoteBelowPinned,
  isNotePinned,
  normalizePinnedNoteOrder,
  setNotePinned
} from "./note-order.js";
import {
  DEFAULT_EDITOR_LINE_SPACING,
  DEFAULT_EDITOR_LINE_NUMBERS,
  DEFAULT_EDITOR_ZOOM,
  DEFAULT_NOTE_PREVIEW_LINES,
  DEFAULT_SYNTAX_HIGHLIGHTING,
  MAX_EDITOR_LINE_SPACING,
  MAX_EDITOR_ZOOM,
  MAX_NOTE_PREVIEW_LINES,
  MIN_EDITOR_LINE_SPACING,
  MIN_EDITOR_ZOOM,
  MIN_NOTE_PREVIEW_LINES,
  normalizeEditorLineSpacing,
  normalizeEditorLineNumbers,
  normalizeEditorZoom,
  normalizeNotePreviewLines,
  normalizeSyntaxHighlighting,
  stepEditorLineSpacing,
  stepEditorZoom,
  stepNotePreviewLines
} from "./view-preferences.js";

// ----------------------------------------------------
// Scratchpad - Core Application Logic
// Handles state, events, markdown compiling, and theme
// ----------------------------------------------------

const { invoke } = window.__TAURI__ ? window.__TAURI__.core : { invoke: () => Promise.resolve() };

// Select DOM elements
const appContainer = document.getElementById("app");
const sidebar = document.getElementById("sidebar");
const toggleSidebarBtn = document.getElementById("toggle-sidebar");
const newNoteBtn = document.getElementById("new-note-btn");
const searchInput = document.getElementById("search-input");
const noteList = document.getElementById("note-list");
const noteTitleInput = document.getElementById("note-title");
const editorWrapper = document.getElementById("editor-wrapper");
const editorTextarea = document.getElementById("editor-textarea");
const editorLineNumbers = document.getElementById("editor-line-numbers");
const previewWrapper = document.getElementById("preview-wrapper");
const markdownPreview = document.getElementById("markdown-preview");
const wordCharCount = document.getElementById("word-char-count");
const cursorPosition = document.getElementById("cursor-position");
const selectionCount = document.getElementById("selection-count");
const saveStatus = document.getElementById("save-status");
const themeToggleBtn = document.getElementById("theme-toggle");
const focusBtn = document.getElementById("focus-btn");
const splitNoteBtn = document.getElementById("split-note-btn");

const modeEditBtn = document.getElementById("mode-edit");
const modeSplitBtn = document.getElementById("mode-split");
const modePreviewBtn = document.getElementById("mode-preview");

const actionsBtn = document.getElementById("actions-btn");
const actionsDropdown = document.getElementById("actions-dropdown-content");
const copyMarkdownBtn = document.getElementById("copy-markdown");
const copyHtmlBtn = document.getElementById("copy-html");
const importBtn = document.getElementById("import-btn");
const exportBtn = document.getElementById("export-btn");
const dbConnectBtn = document.getElementById("db-connect-btn");
const dbDisconnectBtn = document.getElementById("db-disconnect-btn");
const workspaceMenuValue = document.getElementById("workspace-menu-value");
const helpMenuBtn = document.getElementById("help-menu-btn");
const aboutMenuBtn = document.getElementById("about-menu-btn");
const viewSettings = document.getElementById("view-settings");
const zoomOutBtn = document.getElementById("zoom-out-btn");
const zoomResetBtn = document.getElementById("zoom-reset-btn");
const zoomInBtn = document.getElementById("zoom-in-btn");
const lineSpacingDecreaseBtn = document.getElementById("line-spacing-decrease-btn");
const lineSpacingValue = document.getElementById("line-spacing-value");
const lineSpacingIncreaseBtn = document.getElementById("line-spacing-increase-btn");
const previewLinesDecreaseBtn = document.getElementById("preview-lines-decrease-btn");
const previewLinesValue = document.getElementById("preview-lines-value");
const previewLinesIncreaseBtn = document.getElementById("preview-lines-increase-btn");
const syntaxHighlightingToggle = document.getElementById("syntax-highlighting-toggle");
const lineNumbersToggle = document.getElementById("line-numbers-toggle");

const panesContainer = document.getElementById("panes-container");
const primaryPaneWrapper = document.getElementById("primary-pane-wrapper");
const secondaryPaneWrapper = document.getElementById("secondary-pane-wrapper");
const secondaryNoteSelect = document.getElementById("secondary-note-select");
const secondaryNoteTitle = document.getElementById("secondary-note-title");
const closeSecondaryBtn = document.getElementById("close-secondary-btn");
const secondaryEditorPane = document.getElementById("secondary-editor-pane");
const secondaryEditorWrapper = document.getElementById("secondary-editor-wrapper");
const secondaryEditorTextarea = document.getElementById("secondary-editor-textarea");
const secondaryEditorLineNumbers = document.getElementById("secondary-editor-line-numbers");
const secondaryEditorBackdrop = document.getElementById("secondary-editor-backdrop");
const secondaryEditorDivider = document.getElementById("secondary-editor-divider");
const secondaryPreviewWrapper = document.getElementById("secondary-preview-wrapper");
const secondaryMarkdownPreview = document.getElementById("secondary-markdown-preview");

const findBar = document.getElementById("find-bar");
const findInput = document.getElementById("find-input");
const findCount = document.getElementById("find-count");
const findPrevBtn = document.getElementById("find-prev");
const findNextBtn = document.getElementById("find-next");
const findCloseBtn = document.getElementById("find-close");
const findToggleReplaceBtn = document.getElementById("find-toggle-replace");
const findCaseToggleBtn = document.getElementById("find-case-toggle");
const findExactToggleBtn = document.getElementById("find-exact-toggle");
const findRegexToggleBtn = document.getElementById("find-regex-toggle");
const findResultsToggleBtn = document.getElementById("find-results-toggle");
const findResultsPane = document.getElementById("find-results-pane");
const findResultsCloseBtn = document.getElementById("find-results-close");
const findAllNotesToggleBtn = document.getElementById("find-all-notes-toggle");
const findResultsSummary = document.getElementById("find-results-summary");
const findResultsList = document.getElementById("find-results-list");
const replaceRow = document.getElementById("replace-row");
const replaceInput = document.getElementById("replace-input");
const replaceOneBtn = document.getElementById("replace-one-btn");
const replaceAllBtn = document.getElementById("replace-all-btn");
const editorBackdrop = document.getElementById("editor-backdrop");

const customContextMenu = document.getElementById("custom-context-menu");
const ctxCutBtn = document.getElementById("ctx-cut");
const ctxCopyBtn = document.getElementById("ctx-copy");
const ctxPasteBtn = document.getElementById("ctx-paste");
const ctxInsertDivider = document.getElementById("ctx-insert-divider");
const ctxInsertGroup = document.getElementById("ctx-insert-group");
const ctxInsertBtn = document.getElementById("ctx-insert");
const ctxInsertMenu = document.getElementById("ctx-insert-menu");
const ctxSelectAllBtn = document.getElementById("ctx-select-all");
const ctxFindBtn = document.getElementById("ctx-find");
const ctxOpenSideBtn = document.getElementById("ctx-open-side");
const ctxSidebarDivider = document.getElementById("ctx-sidebar-divider");
const ctxPinBtn = document.getElementById("ctx-pin-note");
const ctxMoveUpBtn = document.getElementById("ctx-move-up");
const ctxMoveDownBtn = document.getElementById("ctx-move-down");

const helpBtn = document.getElementById("help-btn");
const helpModalBackdrop = document.getElementById("help-modal-backdrop");
const helpModal = document.getElementById("help-modal");
const closeHelpBtn = document.getElementById("close-help-btn");
const tabShortcutsBtn = document.getElementById("tab-shortcuts-btn");
const tabMarkdownBtn = document.getElementById("tab-markdown-btn");
const paneShortcuts = document.getElementById("pane-shortcuts");
const paneMarkdown = document.getElementById("pane-markdown");
const splitDropOverlay = document.getElementById("split-drop-overlay");

const themePickerBtn = document.getElementById("theme-picker-btn");
const activeThemeMenuValue = document.getElementById("active-theme-menu-value");
const themeModalBackdrop = document.getElementById("theme-modal-backdrop");
const themeModal = document.getElementById("theme-modal");
const closeThemeBtn = document.getElementById("close-theme-btn");
const themeImportBtn = document.getElementById("theme-import-btn");
const themeExportBtn = document.getElementById("theme-export-btn");
const themeGrid = document.getElementById("theme-grid");
const aboutModalBackdrop = document.getElementById("about-modal-backdrop");
const aboutModal = document.getElementById("about-modal");
const closeAboutBtn = document.getElementById("close-about-btn");

// Built-in Developer Palette Presets
const PRESET_THEMES = [
  {
    id: "default-dark",
    name: "Default Dark",
    background: "#090d16",
    foreground: "#f3f4f6",
    sidebar: "#111625",
    accent: "#a855f7",
    border: "#1e2640",
    selection: "#2d1f46"
  },
  {
    id: "default-light",
    name: "Default Light",
    background: "#f8fafc",
    foreground: "#0f172a",
    sidebar: "#ffffff",
    accent: "#a855f7",
    border: "#e2e8f0",
    selection: "#f3e8ff"
  },
  {
    id: "dracula",
    name: "Dracula",
    background: "#282a36",
    foreground: "#f8f8f2",
    sidebar: "#21222c",
    accent: "#bd93f9",
    border: "#44475a",
    selection: "#44475a"
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    sidebar: "#181825",
    accent: "#89b4fa",
    border: "#313244",
    selection: "#45475a"
  },
  {
    id: "nord",
    name: "Nord",
    background: "#2e3440",
    foreground: "#eceff4",
    sidebar: "#242933",
    accent: "#88c0d0",
    border: "#3b4252",
    selection: "#434c5e"
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    background: "#1a1b26",
    foreground: "#a9b1d6",
    sidebar: "#16161e",
    accent: "#7aa2f7",
    border: "#292e42",
    selection: "#283457"
  },
  {
    id: "monokai-pro",
    name: "Monokai Pro",
    background: "#2d2a2e",
    foreground: "#fcfcfa",
    sidebar: "#221f22",
    accent: "#ffd866",
    border: "#403e41",
    selection: "#49464e"
  },
  {
    id: "one-dark-pro",
    name: "One Dark Pro",
    background: "#282c34",
    foreground: "#abb2bf",
    sidebar: "#21252b",
    accent: "#61afef",
    border: "#3e4451",
    selection: "#3e4451"
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    background: "#002b36",
    foreground: "#839496",
    sidebar: "#073642",
    accent: "#268bd2",
    border: "#073642",
    selection: "#073642"
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    background: "#fdf6e3",
    foreground: "#657b83",
    sidebar: "#eee8d5",
    accent: "#268bd2",
    border: "#d33682",
    selection: "#eee8d5"
  },
  {
    id: "amber-crt",
    name: "Amber CRT",
    background: "#120f08",
    foreground: "#f6c453",
    sidebar: "#1b160b",
    accent: "#ffb000",
    border: "#4a3814",
    selection: "#5c4315"
  },
  {
    id: "green-crt",
    name: "Green CRT",
    background: "#07110a",
    foreground: "#7cff8a",
    sidebar: "#0a180d",
    accent: "#39ff65",
    border: "#1d5c2b",
    selection: "#154d24"
  },
  {
    id: "pastel-daydream",
    name: "Pastel Daydream",
    background: "#fff7fb",
    foreground: "#574f64",
    sidebar: "#f5ecfa",
    accent: "#a56cc1",
    border: "#ddcfe8",
    selection: "#eadcf3"
  },
  {
    id: "macintosh-system-6",
    name: "Macintosh System 6",
    background: "#f4f4f4",
    foreground: "#111111",
    sidebar: "#d9d9d9",
    accent: "#000000",
    border: "#777777",
    selection: "#b8b8b8"
  },
  {
    id: "mac-os-9-platinum",
    name: "Mac OS 9 Platinum",
    background: "#ffffff",
    foreground: "#171717",
    sidebar: "#d6d6d6",
    accent: "#315da8",
    border: "#707070",
    selection: "#bed0ec",
    uiStyle: "mac-os-9"
  },
  {
    id: "windows-classic",
    name: "Windows Classic",
    background: "#ffffff",
    foreground: "#000000",
    sidebar: "#c0c0c0",
    accent: "#000080",
    border: "#808080",
    selection: "#a6caf0",
    uiStyle: "windows-classic"
  },
  {
    id: "github-dark",
    name: "GitHub Dark",
    background: "#0d1117",
    foreground: "#c9d1d9",
    sidebar: "#010409",
    accent: "#58a6ff",
    border: "#30363d",
    selection: "#1f6feb"
  }
];

const LEGACY_THEME_IDS = {
  "macintosh-system-7": "mac-os-9-platinum"
};

// State
let notes = [];
let activeNoteId = null;
let secondaryNoteId = null;
let activePane = "primary"; // "primary" or "secondary"
let isSplitNoteMode = false;
let activeDbPath = null;
let currentLayoutMode = "edit"; // edit, split, preview
let isFocusMode = false;
let isHelpModalOpen = false;
let helpModalPreviousFocus = null;
let isThemeModalOpen = false;
let themeModalPreviousFocus = null;
let isAboutModalOpen = false;
let aboutModalPreviousFocus = null;
let customThemes = [];
let activeThemeId = "default-dark";
let findMatches = [];
let activeMatchIndex = -1;
let isFindBarOpen = false;
let isFindResultsOpen = false;
let isFindAllNotesMode = false;
let hasInvalidFindPattern = false;
let contextMenuTarget = null;
let contextMenuNoteId = null;
let isMatchCaseMode = false;
let isExactMatchMode = false;
let isRegexMode = false;
let isReplaceOpen = false;
const noteSaveDebounceTimers = new Map();
let previewDebounceTimer = null;
let highlightRedrawTimer = null;
let highlightSettledRedrawTimer = null;
let highlightResizeObserver = null;
let nativeWindowResizeUnlisten = null;
let dbSaveQueue = Promise.resolve();
let isClosing = false;
let localMirrorFailureNotified = false;
let notificationSequence = 0;
let activeNotification = null;
let currentEditorZoom = DEFAULT_EDITOR_ZOOM;
let editorLineSpacing = DEFAULT_EDITOR_LINE_SPACING;
let notePreviewLines = DEFAULT_NOTE_PREVIEW_LINES;
let syntaxHighlightingEnabled = DEFAULT_SYNTAX_HIGHLIGHTING;
let editorLineNumbersEnabled = DEFAULT_EDITOR_LINE_NUMBERS;
let previewHighlightsRendered = false;

const editorRenderFrameOptions = {
  requestFrame: typeof window.requestAnimationFrame === "function"
    ? (callback) => window.requestAnimationFrame(callback)
    : undefined,
  cancelFrame: typeof window.cancelAnimationFrame === "function"
    ? (frameId) => window.cancelAnimationFrame(frameId)
    : undefined
};
const primaryEditorRenderScheduler = createEditorRenderScheduler(
  () => updateHighlights(),
  editorRenderFrameOptions
);
const secondaryEditorRenderScheduler = createEditorRenderScheduler(
  () => updateSecondaryEditorBackdrop(),
  editorRenderFrameOptions
);

function applyPlatformShortcutLabels() {
  const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || "";
  if (/mac|iphone|ipad|ipod/i.test(platform)) return;

  document.querySelectorAll("[title]").forEach((element) => {
    const title = element.getAttribute("title");
    if (title?.includes("Cmd")) {
      element.setAttribute("title", title.replaceAll("Cmd", "Ctrl"));
    }
  });

  document.querySelectorAll("kbd, .shortcut-hint").forEach((element) => {
    if (element.textContent.includes("Cmd")) {
      element.textContent = element.textContent.replaceAll("Cmd", "Ctrl");
    }
  });
}

// Reports the remembered workspace alongside whether it could be determined at
// all. "Read it, there is no workspace" and "could not read it" look identical
// from the path alone, and only the first is safe to act on: a preference that
// failed to read may still name a workspace that opens on a later launch.
async function loadRememberedWorkspacePath() {
  const legacyPath = localStorage.getItem("scratchpad_active_db");
  if (!window.__TAURI__) return { known: true, path: legacyPath };

  try {
    const savedPath = await invoke("load_workspace_preference", { legacyPath });
    localStorage.removeItem("scratchpad_active_db");
    return { known: true, path: savedPath };
  } catch (err) {
    console.error("Failed to load native workspace preference", err);
    // Unknown even when a legacy path survives: the native preference takes
    // precedence over it and may name a different workspace.
    return { known: false, path: legacyPath };
  }
}

// Initialize app
async function init() {
  // 1. Localize shortcut labels and attach event listeners immediately.
  applyPlatformShortcutLabels();
  attachEventListeners();
  await registerCloseHandler();
  await registerWindowResizeHandler();

  // 2. Load the saved theme (Default Dark on first launch) and layout mode
  loadSavedThemes();
  loadViewPreferences();
  const savedLayoutMode = localStorage.getItem("scratchpad_layout_mode");
  if (savedLayoutMode) {
    setLayoutMode(savedLayoutMode);
  }

  // 3. Always load the local-only collection first as guaranteed baseline
  loadNotesFromLocalStorage();
  adoptLegacyStashedNotes();

  // 4. Check if a native workspace preference is configured. Existing
  // localStorage preferences are migrated once for origin-independent startup.
  const rememberedWorkspace = await loadRememberedWorkspacePath();
  if (rememberedWorkspace.path && window.__TAURI__) {
    activeDbPath = rememberedWorkspace.path;
    try {
      const dbNotes = await invoke("load_db_notes", { dbPath: activeDbPath });
      // Seeding deletes and rewrites the workspace's rows, so an unreadable
      // response must not be mistaken for an empty workspace.
      if (!Array.isArray(dbNotes)) {
        throw new Error("Workspace returned an unexpected response");
      }
      if (dbNotes.length > 0) {
        notes = normalizePinnedNoteOrder(dbNotes);
      } else if (notes.length > 0) {
        // Seed empty SQLite database with existing LocalStorage notes
        await invoke("save_notes_db", { dbPath: activeDbPath, notes });
      }
      updateDbUiState(true);
    } catch (err) {
      console.error("Failed to load notes from SQLite DB on boot", err);
      activeDbPath = null;
      // `notes` still holds the local-only collection: it is only replaced once
      // the workspace has answered. Editing it here cannot be undone by the
      // workspace opening on a later launch.
      updateDbUiState(false);
      showNotification("Workspace unavailable; using local notes");
    }
  } else {
    updateDbUiState(false);
    if (!rememberedWorkspace.known) {
      showNotification("Workspace settings unreadable; using local notes");
    }
  }

  // 5. Create default note if none exist
  if (notes.length === 0) {
    createNote(WELCOME_NOTE_TITLE, WELCOME_NOTE_CONTENT);
  } else {
    // Select first note by default
    activeNoteId = notes[0].id;
  }

  // 6. Render UI
  renderNoteList();
  loadActiveNote();
}

// ----------------------------------------------------
// Theme Handling
// ----------------------------------------------------
function setTheme(theme, pin = true) {
  const isDark = theme === "dark";
  
  if (isDark) {
    document.documentElement.classList.add("theme-dark");
    document.documentElement.classList.remove("theme-light");
    themeToggleBtn.querySelector(".btn-text").textContent = "Theme: Default Dark";
    activeThemeMenuValue.textContent = "Default Dark";
  } else {
    document.documentElement.classList.add("theme-light");
    document.documentElement.classList.remove("theme-dark");
    themeToggleBtn.querySelector(".btn-text").textContent = "Theme: Default Light";
    activeThemeMenuValue.textContent = "Default Light";
  }

  if (pin) {
    localStorage.setItem("color-scheme", theme);
  } else {
    localStorage.removeItem("color-scheme");
  }
}

// ----------------------------------------------------
// Note Management Logic
// ----------------------------------------------------
function createNote(title = "Untitled Scratchpad", content = "") {
  const newNote = {
    id: "note_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9),
    title: title,
    content: content,
    updatedAt: Date.now(),
    isTitleLocked: title !== "Untitled Scratchpad" && title !== WELCOME_NOTE_TITLE,
    isPinned: false
  };
  
  notes = insertNoteBelowPinned(notes, newNote);
  activeNoteId = newNote.id;
  
  saveNotesToStorage({ syncWorkspace: true });
  renderNoteList();
  loadActiveNote();
  
  // Highlight note list scroll top
  document.querySelector(".note-list-container").scrollTop = 0;
  editorTextarea.focus();
}

function deleteNote(id, event) {
  if (event) event.stopPropagation();
  
  const index = notes.findIndex(n => n.id === id);
  if (index === -1) return;
  
  notes.splice(index, 1);
  
  // Handle active note deletion
  if (activeNoteId === id) {
    if (notes.length > 0) {
      activeNoteId = notes[0].id;
    } else {
      // Create a clean blank note if we deleted the last one
      createNote();
      return;
    }
  }
  
  saveNotesToStorage({ syncWorkspace: true });
  renderNoteList();
  loadActiveNote();
}

function loadActiveNote() {
  const activeNote = notes.find(n => n.id === activeNoteId);
  if (!activeNote) return;

  noteTitleInput.value = activeNote.title;
  editorTextarea.value = activeNote.content;
  
  updateWordCharCount();
  updateMarkdownPreview();
  
  // Reset scrolling of editor & preview
  editorTextarea.scrollTop = 0;
  editorBackdrop.scrollTop = 0;
  editorLineNumbers.scrollTop = 0;
  markdownPreview.scrollTop = 0;
  if (isFindBarOpen) {
    runFind({ selectActive: false });
  } else {
    updateHighlights();
  }
}

function renderNoteList(filter = "") {
  noteList.innerHTML = "";
  
  const filteredNotes = notes.filter(note => {
    const query = filter.toLowerCase();
    return note.title.toLowerCase().includes(query) || note.content.toLowerCase().includes(query);
  });
  
  filteredNotes.forEach(note => {
    const item = document.createElement("li");
    item.className = `note-item ${note.id === activeNoteId ? "active" : ""} ${isNotePinned(note) ? "pinned" : ""}`;
    item.setAttribute("data-id", note.id);
    item.setAttribute("data-pinned", String(isNotePinned(note)));
    item.tabIndex = 0;
    item.setAttribute("aria-label", `Open ${isNotePinned(note) ? "pinned " : ""}${note.title}`);
    if (note.id === activeNoteId) item.setAttribute("aria-current", "true");
    
    const snippet = getNotePreview(note, notePreviewLines);
    
    const formattedDate = new Date(note.updatedAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });

    item.innerHTML = `
      <div class="note-item-header">
        <span class="note-item-title">${escapeHTML(note.title)}</span>
        <div class="note-item-actions">
          <button class="note-item-pin" title="${isNotePinned(note) ? "Unpin scratchpad" : "Pin scratchpad to top"}" aria-label="${isNotePinned(note) ? "Unpin" : "Pin"} ${escapeHTML(note.title)}" aria-pressed="${String(isNotePinned(note))}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 17v5M5 17h14M15 3.5l5.5 5.5-3 1.5-4 4-1.5 3-5-5 3-1.5 4-4L15 3.5z" />
            </svg>
          </button>
          <button class="note-item-delete" title="Delete scratchpad" aria-label="Delete ${escapeHTML(note.title)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
      <div class="note-item-snippet">${escapeHTML(snippet)}</div>
      <div class="note-item-meta">
        <span>${formattedDate}</span>
      </div>
    `;
    
    let isItemDragged = false;

    // Switch to selected note on click
    item.addEventListener("click", (e) => {
      if (isItemDragged) {
        isItemDragged = false;
        return;
      }
      if (isSplitNoteMode && activePane === "secondary") {
        secondaryNoteId = note.id;
        populateSecondaryNoteSelect();
        loadSecondaryNote();
      } else {
        activeNoteId = note.id;
        renderNoteList(searchInput.value);
        loadActiveNote();
      }
    });

    item.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && !e.target.closest("button")) {
        e.preventDefault();
        item.click();
      }
    });

    // Right click for context menu (Open to the side, move up/down)
    item.addEventListener("contextmenu", (e) => {
      e.stopPropagation();
      contextMenuNoteId = note.id;
      showContextMenu(e, note.id);
    });

    // Pointer-based drag and drop for rock-solid reordering in desktop webviews
    item.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button")) return;
      
      const pointerId = e.pointerId;
      try {
        item.setPointerCapture(pointerId);
      } catch (err) {}

      const startX = e.clientX;
      const startY = e.clientY;
      let hasDragged = false;
      let dragAvatar = null;
      let dropTarget = null;
      let dropPosition = "bottom";
      let isOverSplitDropZone = false;

      function onPointerMove(moveEvent) {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;

        // 4px threshold to distinguish normal click from dragging
        if (!hasDragged && Math.hypot(dx, dy) > 4) {
          hasDragged = true;
          isItemDragged = true;
          item.classList.add("dragging");

          dragAvatar = item.cloneNode(true);
          dragAvatar.className = "note-item drag-avatar";
          dragAvatar.style.width = `${item.offsetWidth}px`;
          dragAvatar.style.position = "fixed";
          dragAvatar.style.pointerEvents = "none";
          dragAvatar.style.zIndex = "9999";
          dragAvatar.style.opacity = "0.9";
          dragAvatar.style.left = `${moveEvent.clientX - 20}px`;
          dragAvatar.style.top = `${moveEvent.clientY - 20}px`;
          document.body.appendChild(dragAvatar);
        }

        if (hasDragged && dragAvatar) {
          dragAvatar.style.left = `${moveEvent.clientX - 20}px`;
          dragAvatar.style.top = `${moveEvent.clientY - 20}px`;

          const sidebarRect = sidebar.getBoundingClientRect();
          const isPastSidebar = moveEvent.clientX > (sidebarRect.right + 10);

          if (isPastSidebar) {
            // Dragging over the editor workspace!
            document.querySelectorAll(".note-item").forEach(el => {
              el.classList.remove("drag-over-top", "drag-over-bottom");
            });
            dropTarget = null;
            isOverSplitDropZone = true;
            splitDropOverlay.style.display = "flex";
          } else {
            // Inside the sidebar list: Reordering mode
            isOverSplitDropZone = false;
            splitDropOverlay.style.display = "none";

            // Hit test underneath the cursor
            dragAvatar.style.display = "none";
            const elemBelow = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
            dragAvatar.style.display = "flex";

            const targetItem = elemBelow ? elemBelow.closest(".note-item:not(.drag-avatar)") : null;

            document.querySelectorAll(".note-item").forEach(el => {
              el.classList.remove("drag-over-top", "drag-over-bottom");
            });

            const targetNote = targetItem
              ? notes.find(candidate => candidate.id === targetItem.getAttribute("data-id"))
              : null;

            if (targetItem && targetItem !== item && isNotePinned(targetNote) === isNotePinned(note)) {
              dropTarget = targetItem;
              const rect = targetItem.getBoundingClientRect();
              const isTop = (moveEvent.clientY - rect.top) < (rect.height / 2);
              dropPosition = isTop ? "top" : "bottom";
              targetItem.classList.toggle("drag-over-top", isTop);
              targetItem.classList.toggle("drag-over-bottom", !isTop);
            } else {
              dropTarget = null;
            }
          }
        }
      }

      function onPointerUp(upEvent) {
        try {
          item.releasePointerCapture(pointerId);
        } catch (err) {}

        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);

        if (dragAvatar) {
          dragAvatar.remove();
          dragAvatar = null;
        }

        splitDropOverlay.style.display = "none";

        document.querySelectorAll(".note-item").forEach(el => {
          el.classList.remove("drag-over-top", "drag-over-bottom", "dragging");
        });

        if (hasDragged && isOverSplitDropZone) {
          openNoteInSecondaryPane(note.id);
          showNotification(`Opened "${note.title}" side-by-side`);
        } else if (hasDragged && dropTarget) {
          const targetId = dropTarget.getAttribute("data-id");
          if (targetId && targetId !== note.id) {
            const fromIndex = notes.findIndex(n => n.id === note.id);
            const toIndex = notes.findIndex(n => n.id === targetId);

            if (fromIndex !== -1 && toIndex !== -1) {
              const [draggedNote] = notes.splice(fromIndex, 1);
              let targetIndex = notes.findIndex(n => n.id === targetId);
              if (dropPosition === "bottom") {
                targetIndex += 1;
              }
              notes.splice(targetIndex, 0, draggedNote);

              saveNotesToStorage({ syncWorkspace: true });
              renderNoteList(searchInput.value);
              populateSecondaryNoteSelect();
              showNotification("Notes reordered");
            }
          }
        }
      }

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    });
    
    item.querySelector(".note-item-pin").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleNotePinned(note.id);
    });

    // Delete listener
    item.querySelector(".note-item-delete").addEventListener("click", (e) => {
      deleteNote(note.id, e);
    });

    noteList.appendChild(item);
  });
}

// A workspace owns its own storage. Local storage holds the local-only
// collection and nothing else, so a workspace session never writes over notes
// it does not contain.
function saveNotesToStorage({ noteId = activeNoteId, syncWorkspace = false } = {}) {
  if (activeDbPath) {
    const dbPath = activeDbPath;
    let command;
    let payload;

    if (syncWorkspace) {
      command = "save_notes_db";
      payload = { dbPath, notes: notes.map(note => ({ ...note })) };
    } else {
      const sortOrder = notes.findIndex(note => note.id === noteId);
      if (sortOrder === -1) return Promise.resolve(true);
      command = "save_note_db";
      payload = { dbPath, note: { ...notes[sortOrder] }, sortOrder };
    }

    // Serialize writes so a slower, older save cannot overwrite a newer edit
    // or structural workspace change.
    const workspaceSave = dbSaveQueue
      .then(() => {
        if (activeDbPath !== dbPath) return true;
        return invoke(command, payload).then(() => true);
      })
      .catch(err => {
        console.error("Failed to save notes to SQLite DB", err);
        setSaveFailedState();
        return false;
      });

    dbSaveQueue = workspaceSave.then(() => undefined);
    return workspaceSave;
  }

  const localResult = persistNotesLocally(localStorage, notes);

  if (localResult.ok) {
    localMirrorFailureNotified = false;
  } else {
    console.error("Failed to save the local notes", localResult.error);
    if (!localMirrorFailureNotified) {
      showNotification("Local save failed; free some disk space or connect a workspace");
      localMirrorFailureNotified = true;
    }
  }

  return Promise.resolve(localResult.ok);
}

function scheduleNoteSave(noteId, afterSave) {
  clearTimeout(noteSaveDebounceTimers.get(noteId));
  const timer = setTimeout(() => {
    noteSaveDebounceTimers.delete(noteId);
    const saveResult = saveNotesToStorage({ noteId });
    if (afterSave) afterSave();
    saveResult.then((saved) => {
      if (noteSaveDebounceTimers.size > 0) return;
      if (saved) {
        setSavedState();
      } else {
        setSaveFailedState();
      }
    });
  }, 400);
  noteSaveDebounceTimers.set(noteId, timer);
}

function setSaveFailedState() {
  saveStatus.textContent = "Save failed";
  saveStatus.title = "Scratchpad could not persist the latest changes";
  saveStatus.classList.add("unsaved");
}

function clearPendingSaveTimers() {
  noteSaveDebounceTimers.forEach(timer => clearTimeout(timer));
  noteSaveDebounceTimers.clear();
}

async function flushPendingSaves() {
  clearPendingSaveTimers();
  return saveNotesToStorage({ syncWorkspace: true });
}

function persistLocalMirrorBeforePageExit() {
  // A workspace session has nothing to flush here, and writing would replace
  // the local-only collection with the workspace's notes.
  if (activeDbPath) return;

  const result = persistNotesLocally(localStorage, notes);
  if (!result.ok) {
    console.error("Failed to flush notes during page exit", result.error);
  }
}

async function registerCloseHandler() {
  const getCurrentWindow = window.__TAURI__?.window?.getCurrentWindow;
  if (typeof getCurrentWindow !== "function") return;

  try {
    const appWindow = getCurrentWindow();
    await appWindow.onCloseRequested(async (event) => {
      if (isClosing) return;

      event.preventDefault();
      const saved = await flushPendingSaves();
      if (!saved) {
        setSaveFailedState();
        showNotification("Could not save the latest changes; close cancelled");
        return;
      }

      isClosing = true;
      try {
        await appWindow.destroy();
      } catch (error) {
        isClosing = false;
        console.error("Failed to close Scratchpad after saving", error);
        showNotification("Could not close Scratchpad");
      }
    });
  } catch (error) {
    console.error("Failed to register the close-save handler", error);
  }
}

async function registerWindowResizeHandler() {
  const getCurrentWindow = window.__TAURI__?.window?.getCurrentWindow;
  if (typeof getCurrentWindow !== "function") return;

  try {
    const appWindow = getCurrentWindow();
    if (typeof appWindow.onResized !== "function") return;

    nativeWindowResizeUnlisten = await appWindow.onResized(() => {
      scheduleFindHighlightRedraw(80);
    });
  } catch (error) {
    console.error("Failed to register the native highlight resize handler", error);
  }
}

// ----------------------------------------------------
// UI Logic: Word counts, auto-saves, live previews
// ----------------------------------------------------
function handleEditorInput() {
  const activeNote = notes.find(n => n.id === activeNoteId);
  if (!activeNote) return;

  activeNote.content = editorTextarea.value;
  activeNote.updatedAt = Date.now();
  updateCursorPositionForText(editorTextarea);
  if (isFindBarOpen) {
    runFind({ preserveActive: true, selectActive: false });
  } else {
    primaryEditorRenderScheduler.schedule();
  }

  // Auto-rename the title from the first line until the user edits it manually.
  if (!activeNote.isTitleLocked) {
    const lines = editorTextarea.value.trim().split("\n");
    let firstLine = lines[0] || "";
    // Clean markdown headings out of title
    firstLine = firstLine.replace(/^#+\s+/, "").trim();
    
    const newTitle = firstLine ? firstLine.substring(0, 30) : "Untitled Scratchpad";
    if (activeNote.title !== newTitle) {
      activeNote.title = newTitle;
      noteTitleInput.value = newTitle;
    }
  }

  // Visual auto-save feedback
  triggerSavingState();

  // Save notes locally
  scheduleNoteSave(activeNote.id, () => {
    renderNoteList(searchInput.value);
  });

  // Live markdown compilation
  clearTimeout(previewDebounceTimer);
  previewDebounceTimer = setTimeout(() => {
    updateMarkdownPreview();
    updateWordCharCount();
  }, 150);
}

function handleTitleInput() {
  const activeNote = notes.find(n => n.id === activeNoteId);
  if (!activeNote) return;

  activeNote.title = noteTitleInput.value.trim() || "Untitled Scratchpad";
  activeNote.isTitleLocked = true; // User edited manually, lock auto-renaming
  activeNote.updatedAt = Date.now();

  if (isFindResultsOpen && isFindAllNotesMode) {
    renderFindResults();
  }

  triggerSavingState();
  
  scheduleNoteSave(activeNote.id, () => {
    renderNoteList(searchInput.value);
  });
}

function triggerSavingState() {
  saveStatus.textContent = "Saving...";
  saveStatus.title = "Scratchpad is saving the latest changes";
  saveStatus.classList.add("unsaved");
}

function setSavedState() {
  if (activeDbPath) {
    const fileName = activeDbPath.split(/[/\\]/).pop();
    saveStatus.textContent = `Saved (${fileName})`;
    saveStatus.title = `Workspace: ${activeDbPath}`;
  } else {
    saveStatus.textContent = "Saved";
    saveStatus.title = "Saved to local webview storage";
  }
  saveStatus.classList.remove("unsaved");
}

function updateWordCharCount() {
  const text = editorTextarea.value;
  const totalWords = text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
  const totalChars = text.length;
  
  // Always update global count on the left
  wordCharCount.textContent = `${totalWords} word${totalWords !== 1 ? 's' : ''} • ${totalChars} character${totalChars !== 1 ? 's' : ''}`;
  updateCursorPositionForText(editorTextarea);

  const start = editorTextarea.selectionStart;
  const end = editorTextarea.selectionEnd;
  
  if (start !== end && start !== undefined && end !== undefined) {
    const selectedText = text.substring(start, end);
    const selectedWords = selectedText.trim() ? selectedText.trim().split(/\s+/).filter(Boolean).length : 0;
    const selectedChars = selectedText.length;
    
    // Show and update selection count on the right
    selectionCount.textContent = `${selectedWords} word${selectedWords !== 1 ? 's' : ''} • ${selectedChars} character${selectedChars !== 1 ? 's' : ''} selected`;
    selectionCount.style.display = "inline-block";
  } else {
    // Hide selection count on the right
    selectionCount.style.display = "none";
  }
}

function updateMarkdownPreview() {
  if (currentLayoutMode === "edit" || isSplitNoteMode) return; // don't render if not visible or in dual-note split mode

  const rawText = editorTextarea.value;
  
  if (window.marked) {
    try {
      let html = "";
      if (typeof window.marked.parse === "function") {
        html = renderMarkdown(rawText, "*Empty scratchpad*");
      } else if (typeof window.marked === "function") {
        html = sanitizeMarkdownHtml(window.marked(rawText || "*Empty scratchpad*"));
      } else {
        throw new Error("window.marked is neither a function nor contains a parse function");
      }
      markdownPreview.innerHTML = html;
      highlightPreviewCode(markdownPreview, window.hljs, syntaxHighlightingEnabled);
    } catch (e) {
      console.error("Marked parser error:", e);
      markdownPreview.innerHTML = `<div style="color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); background: rgba(239, 68, 68, 0.05); padding: 12px; border-radius: 8px; margin-bottom: 16px; font-size: 0.9rem;">
        <strong>Markdown Parsing Error:</strong> ${escapeHTML(e.message)}
      </div>` + escapeHTML(rawText).replace(/\n/g, "<br>").replace(/ /g, "&nbsp;");
    }
  } else {
    // Fallback if marked is offline / missing - render as plaintext with line breaks preserved
    console.warn("window.marked is not defined! Rendering as plain text.");
    markdownPreview.innerHTML = `<div style="color: #eab308; border: 1px solid rgba(234, 179, 8, 0.2); background: rgba(234, 179, 8, 0.05); padding: 12px; border-radius: 8px; margin-bottom: 16px; font-size: 0.9rem;">
      <strong>Notice:</strong> Markdown parser not loaded. Displaying as formatted text.
    </div>` + escapeHTML(rawText).replace(/\n/g, "<br>").replace(/  /g, "&nbsp;&nbsp;");
  }

  updatePreviewHighlights();
}

// ----------------------------------------------------
// UI Layout Modes (Edit, Split, Preview, Focus)
// ----------------------------------------------------
function setLayoutMode(mode) {
  currentLayoutMode = mode;
  localStorage.setItem("scratchpad_layout_mode", mode);

  // Manage UI classes
  appContainer.classList.remove("mode-split", "mode-preview");
  modeEditBtn.classList.remove("active");
  modeSplitBtn.classList.remove("active");
  modePreviewBtn.classList.remove("active");
  modeEditBtn.setAttribute("aria-pressed", String(mode === "edit"));
  modeSplitBtn.setAttribute("aria-pressed", String(mode === "split"));
  modePreviewBtn.setAttribute("aria-pressed", String(mode === "preview"));

  if (mode === "split") {
    appContainer.classList.add("mode-split");
    modeSplitBtn.classList.add("active");
    updateMarkdownPreview();
  } else if (mode === "preview") {
    appContainer.classList.add("mode-preview");
    modePreviewBtn.classList.add("active");
    updateMarkdownPreview();
  } else {
    modeEditBtn.classList.add("active");
  }

  scheduleFindHighlightRedraw();
}

function applyEditorZoom(value, { persist = true } = {}) {
  currentEditorZoom = normalizeEditorZoom(value);
  document.documentElement.style.setProperty("--editor-font-size", `${currentEditorZoom}rem`);
  zoomResetBtn.textContent = `${Math.round(currentEditorZoom * 100)}%`;
  zoomOutBtn.disabled = currentEditorZoom <= MIN_EDITOR_ZOOM;
  zoomInBtn.disabled = currentEditorZoom >= MAX_EDITOR_ZOOM;

  if (persist) {
    localStorage.setItem("scratchpad_editor_zoom", String(currentEditorZoom));
  }
  scheduleFindHighlightRedraw(80);
}

function applyEditorLineSpacing(value, { persist = true } = {}) {
  editorLineSpacing = normalizeEditorLineSpacing(value);
  document.documentElement.style.setProperty("--editor-line-height", String(editorLineSpacing));
  lineSpacingValue.textContent = `${editorLineSpacing.toFixed(1)}×`;
  lineSpacingDecreaseBtn.disabled = editorLineSpacing <= MIN_EDITOR_LINE_SPACING;
  lineSpacingIncreaseBtn.disabled = editorLineSpacing >= MAX_EDITOR_LINE_SPACING;

  if (persist) {
    localStorage.setItem("scratchpad_editor_line_spacing", String(editorLineSpacing));
  }
  scheduleFindHighlightRedraw(80);
}

function applyNotePreviewLines(value, { persist = true, render = true } = {}) {
  notePreviewLines = normalizeNotePreviewLines(value);
  document.documentElement.style.setProperty("--note-preview-lines", String(notePreviewLines));
  previewLinesValue.textContent = String(notePreviewLines);
  previewLinesDecreaseBtn.disabled = notePreviewLines <= MIN_NOTE_PREVIEW_LINES;
  previewLinesIncreaseBtn.disabled = notePreviewLines >= MAX_NOTE_PREVIEW_LINES;

  if (persist) {
    localStorage.setItem("scratchpad_note_preview_lines", String(notePreviewLines));
  }
  if (render) {
    renderNoteList(searchInput.value);
  }
}

function updateSecondaryEditorBackdrop() {
  secondaryEditorRenderScheduler.cancel();
  secondaryEditorBackdrop.innerHTML = renderEditorBackdrop(secondaryEditorTextarea.value, {
    syntaxEnabled: syntaxHighlightingEnabled
  });
  updateEditorLineNumberGutter(
    secondaryEditorTextarea,
    secondaryEditorLineNumbers,
    secondaryEditorWrapper
  );
}

function updateEditorLineNumberGutter(textarea, gutter, wrapper) {
  if (!editorLineNumbersEnabled) {
    if (gutter.childNodes.length > 0) gutter.replaceChildren();
    return;
  }

  const lineCount = textarea.value.split("\n").length;
  const digitCount = String(lineCount).length;
  wrapper.style.setProperty("--editor-line-number-gutter", `calc(${digitCount}ch + 1.5em)`);
  gutter.innerHTML = renderEditorLineNumbers(textarea.value);
}

function applyEditorLineNumbers(value, { persist = true, render = true } = {}) {
  editorLineNumbersEnabled = normalizeEditorLineNumbers(value);
  document.documentElement.classList.toggle("editor-line-numbers-enabled", editorLineNumbersEnabled);
  lineNumbersToggle.textContent = editorLineNumbersEnabled ? "On" : "Off";
  lineNumbersToggle.setAttribute("aria-pressed", String(editorLineNumbersEnabled));

  if (persist) {
    localStorage.setItem("scratchpad_editor_line_numbers", String(editorLineNumbersEnabled));
  }
  if (render) {
    updateEditorLineNumberGutter(editorTextarea, editorLineNumbers, editorWrapper);
    updateEditorLineNumberGutter(
      secondaryEditorTextarea,
      secondaryEditorLineNumbers,
      secondaryEditorWrapper
    );
  }
}

function applySyntaxHighlighting(value, { persist = true, render = true } = {}) {
  syntaxHighlightingEnabled = normalizeSyntaxHighlighting(value);
  document.documentElement.classList.toggle("syntax-highlighting-enabled", syntaxHighlightingEnabled);
  syntaxHighlightingToggle.textContent = syntaxHighlightingEnabled ? "On" : "Off";
  syntaxHighlightingToggle.setAttribute("aria-pressed", String(syntaxHighlightingEnabled));

  if (persist) {
    localStorage.setItem("scratchpad_syntax_highlighting", String(syntaxHighlightingEnabled));
  }
  if (render) {
    updateHighlights();
    updateSecondaryEditorBackdrop();
    updateMarkdownPreview();
    updateSecondaryMarkdownPreview();
  }
}

function loadViewPreferences() {
  applyEditorZoom(localStorage.getItem("scratchpad_editor_zoom") ?? DEFAULT_EDITOR_ZOOM, {
    persist: false
  });
  applyEditorLineSpacing(
    localStorage.getItem("scratchpad_editor_line_spacing") ?? DEFAULT_EDITOR_LINE_SPACING,
    { persist: false }
  );
  applyNotePreviewLines(
    localStorage.getItem("scratchpad_note_preview_lines") ?? DEFAULT_NOTE_PREVIEW_LINES,
    { persist: false, render: false }
  );
  applySyntaxHighlighting(
    localStorage.getItem("scratchpad_syntax_highlighting") ?? DEFAULT_SYNTAX_HIGHLIGHTING,
    { persist: false, render: false }
  );
  applyEditorLineNumbers(
    localStorage.getItem("scratchpad_editor_line_numbers") ?? DEFAULT_EDITOR_LINE_NUMBERS,
    { persist: false }
  );
}

function toggleSidebar() {
  sidebar.classList.toggle("collapsed");
  toggleSidebarBtn.setAttribute("aria-expanded", String(!sidebar.classList.contains("collapsed")));
  scheduleFindHighlightRedraw(250);
}

function toggleFocusMode() {
  isFocusMode = !isFocusMode;
  focusBtn.setAttribute("aria-pressed", String(isFocusMode));
  if (isFocusMode) {
    appContainer.classList.add("focus-mode");
    sidebar.classList.add("collapsed");
    toggleSidebarBtn.setAttribute("aria-expanded", "false");
  } else {
    appContainer.classList.remove("focus-mode");
    sidebar.classList.remove("collapsed");
    toggleSidebarBtn.setAttribute("aria-expanded", "true");
  }
  scheduleFindHighlightRedraw(250);
}

// ----------------------------------------------------
// Scratchpad menu actions
// ----------------------------------------------------
function toggleActionsDropdown(show) {
  if (show === undefined) {
    actionsDropdown.classList.toggle("show");
  } else if (show) {
    actionsDropdown.classList.add("show");
  } else {
    actionsDropdown.classList.remove("show");
  }
  actionsBtn.setAttribute("aria-expanded", String(actionsDropdown.classList.contains("show")));
}

function copyMarkdownToClipboard() {
  const text = editorTextarea.value;
  navigator.clipboard.writeText(text).then(() => {
    showNotification("Markdown copied to clipboard!");
  }).catch(err => {
    console.error("Failed to copy", err);
  });
}

function copyHtmlToClipboard() {
  // Render temporary markdown if in full edit mode
  let html = markdownPreview.innerHTML;
  if (currentLayoutMode === "edit" && window.marked) {
    html = renderMarkdown(editorTextarea.value);
  }
  
  navigator.clipboard.writeText(html).then(() => {
    showNotification("HTML preview copied to clipboard!");
  }).catch(err => {
    console.error("Failed to copy", err);
  });
}

function exportAsMarkdownFile() {
  const activeNote = notes.find(n => n.id === activeNoteId);
  if (!activeNote) return;

  const content = activeNote.content;
  const fileName = activeNote.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".md";
  
  if (window.__TAURI__) {
    // Show a saving state
    saveStatus.textContent = "Exporting...";
    invoke("save_file_native", { content: content, defaultName: fileName })
      .then((path) => {
        showNotification("Saved successfully");
      })
      .catch((err) => {
        if (err !== "Cancelled") {
          showNotification("Export failed: " + err);
        } else {
          setSavedState(); // Restore Saved indicator
        }
      });
  } else {
    // Safe web-based blob download fallback compatible across systems
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8;" });
    const link = document.createElement("a");
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", fileName);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showNotification(`Exported as ${fileName}`);
    }
  }
}

function importFile() {
  if (window.__TAURI__) {
    invoke("import_file_native")
      .then((file) => {
        if (file) {
          createNote(file.title, file.content);
          showNotification("Imported: " + file.title);
        }
      })
      .catch((err) => {
        alert("Unsupported File Format: " + err);
        showNotification("Import failed");
      });
  } else {
    // Safe web-based file reader fallback compatible across browser environments
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (evt) => {
        const lastDot = file.name.lastIndexOf('.');
        const title = (lastDot > 0) ? file.name.substring(0, lastDot) : file.name;
        createNote(title, evt.target.result);
        showNotification("Imported: " + title);
      };
      reader.onerror = () => {
        alert(`Unsupported File Format: The file "${file.name}" could not be read as text.`);
      };
      reader.readAsText(file);
    };
    input.click();
  }
}

function showNotification(msg) {
  const sequence = ++notificationSequence;
  const restoreState = activeNotification && saveStatus.textContent === activeNotification.message
    ? activeNotification.restoreState
    : {
        textContent: saveStatus.textContent,
        className: saveStatus.className,
        title: saveStatus.title
      };

  activeNotification = { sequence, message: msg, restoreState };
  
  saveStatus.textContent = msg;
  saveStatus.className = ""; // clear unsaved indicator during alert
  
  setTimeout(() => {
    dismissNotification(msg, sequence);
  }, 2000);
}

function dismissNotification(message, sequence = null) {
  if (!activeNotification || activeNotification.message !== message) return;
  if (sequence !== null && activeNotification.sequence !== sequence) return;

  const { restoreState } = activeNotification;
  activeNotification = null;
  notificationSequence += 1;

  if (saveStatus.textContent !== message) return;
  saveStatus.textContent = restoreState.textContent;
  saveStatus.className = restoreState.className;
  saveStatus.title = restoreState.title;
}

// ----------------------------------------------------
// Event Listeners
// ----------------------------------------------------
function attachEventListeners() {
  // Editor and Title inputs
  editorTextarea.addEventListener("input", handleEditorInput);
  editorTextarea.addEventListener("keydown", handleEditorTab);
  editorTextarea.addEventListener("keydown", handleMarkdownAutocomplete);
  editorTextarea.addEventListener("keydown", handleEditorSmartKeydown);
  editorTextarea.addEventListener("paste", handleMarkdownPaste);
  editorTextarea.addEventListener("select", updateWordCharCount);
  editorTextarea.addEventListener("mouseup", updateWordCharCount);
  editorTextarea.addEventListener("keyup", updateWordCharCount);
  noteTitleInput.addEventListener("input", handleTitleInput);

  window.addEventListener("resize", () => scheduleFindHighlightRedraw(80));
  if (typeof window.ResizeObserver === "function") {
    highlightResizeObserver = new window.ResizeObserver(() => {
      scheduleFindHighlightRedraw(80);
    });
    highlightResizeObserver.observe(editorWrapper);
    highlightResizeObserver.observe(previewWrapper);
  }

  // Sidebar toggle
  toggleSidebarBtn.addEventListener("click", toggleSidebar);

  // New note button
  newNoteBtn.addEventListener("click", () => createNote());

  // Search filter
  searchInput.addEventListener("input", (e) => {
    renderNoteList(e.target.value);
  });

  // Layout mode controls
  modeEditBtn.addEventListener("click", () => setLayoutMode("edit"));
  modeSplitBtn.addEventListener("click", () => setLayoutMode("split"));
  modePreviewBtn.addEventListener("click", () => setLayoutMode("preview"));

  // Markdown preview links
  markdownPreview.addEventListener("click", handlePreviewLinkClick);
  secondaryMarkdownPreview.addEventListener("click", handlePreviewLinkClick);

  // Focus toggle
  focusBtn.addEventListener("click", toggleFocusMode);

  // Help & Reference Modal
  helpBtn.addEventListener("click", () => openHelpModal());
  helpMenuBtn.addEventListener("click", () => {
    toggleActionsDropdown(false);
    actionsBtn.focus({ preventScroll: true });
    openHelpModal();
  });
  closeHelpBtn.addEventListener("click", closeHelpModal);
  helpModalBackdrop.addEventListener("click", (e) => {
    if (e.target === helpModalBackdrop) closeHelpModal();
  });
  tabShortcutsBtn.addEventListener("click", () => switchHelpTab("shortcuts"));
  tabMarkdownBtn.addEventListener("click", () => switchHelpTab("markdown"));

  // About Modal
  aboutMenuBtn.addEventListener("click", () => {
    toggleActionsDropdown(false);
    actionsBtn.focus({ preventScroll: true });
    openAboutModal();
  });
  closeAboutBtn.addEventListener("click", closeAboutModal);
  aboutModalBackdrop.addEventListener("click", (e) => {
    if (e.target === aboutModalBackdrop) closeAboutModal();
  });
  aboutModal.addEventListener("click", handlePreviewLinkClick);

  // Split Note toggle
  splitNoteBtn.addEventListener("click", () => toggleSplitNoteMode());
  closeSecondaryBtn.addEventListener("click", () => toggleSplitNoteMode(false));
  secondaryNoteSelect.addEventListener("change", (e) => {
    secondaryNoteId = e.target.value;
    loadSecondaryNote();
  });
  secondaryEditorTextarea.addEventListener("input", handleSecondaryEditorInput);
  secondaryEditorTextarea.addEventListener("keydown", handleEditorTab);
  secondaryEditorTextarea.addEventListener("keydown", handleMarkdownAutocomplete);
  secondaryEditorTextarea.addEventListener("keydown", handleEditorSmartKeydown);
  secondaryEditorTextarea.addEventListener("paste", handleMarkdownPaste);
  secondaryEditorTextarea.addEventListener("select", () => updateWordCharCountForText(secondaryEditorTextarea));
  secondaryEditorTextarea.addEventListener("mouseup", () => updateWordCharCountForText(secondaryEditorTextarea));
  secondaryEditorTextarea.addEventListener("keyup", () => updateWordCharCountForText(secondaryEditorTextarea));
  secondaryEditorTextarea.addEventListener("focus", () => setActivePane("secondary"));
  editorTextarea.addEventListener("focus", () => setActivePane("primary"));
  secondaryNoteTitle.addEventListener("input", handleSecondaryTitleInput);

  // Theme selector button in sidebar footer
  themeToggleBtn.addEventListener("click", openThemeModal);

  // Theme Picker Modal
  themePickerBtn.addEventListener("click", () => {
    toggleActionsDropdown(false);
    openThemeModal();
  });
  closeThemeBtn.addEventListener("click", closeThemeModal);
  themeModalBackdrop.addEventListener("click", (e) => {
    if (e.target === themeModalBackdrop) closeThemeModal();
  });
  themeImportBtn.addEventListener("click", importThemeFile);
  themeExportBtn.addEventListener("click", exportCurrentTheme);

  // Actions menu
  actionsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleActionsDropdown();
  });

  document.addEventListener("click", () => {
    toggleActionsDropdown(false);
  });

  viewSettings.addEventListener("click", (e) => e.stopPropagation());
  zoomOutBtn.addEventListener("click", () => applyEditorZoom(stepEditorZoom(currentEditorZoom, -1)));
  zoomResetBtn.addEventListener("click", () => applyEditorZoom(DEFAULT_EDITOR_ZOOM));
  zoomInBtn.addEventListener("click", () => applyEditorZoom(stepEditorZoom(currentEditorZoom, 1)));
  lineSpacingDecreaseBtn.addEventListener("click", () => {
    applyEditorLineSpacing(stepEditorLineSpacing(editorLineSpacing, -1));
  });
  lineSpacingValue.addEventListener("click", () => {
    applyEditorLineSpacing(DEFAULT_EDITOR_LINE_SPACING);
  });
  lineSpacingIncreaseBtn.addEventListener("click", () => {
    applyEditorLineSpacing(stepEditorLineSpacing(editorLineSpacing, 1));
  });
  previewLinesDecreaseBtn.addEventListener("click", () => {
    applyNotePreviewLines(stepNotePreviewLines(notePreviewLines, -1));
  });
  previewLinesValue.addEventListener("click", () => {
    applyNotePreviewLines(DEFAULT_NOTE_PREVIEW_LINES);
  });
  previewLinesIncreaseBtn.addEventListener("click", () => {
    applyNotePreviewLines(stepNotePreviewLines(notePreviewLines, 1));
  });
  syntaxHighlightingToggle.addEventListener("click", () => {
    applySyntaxHighlighting(!syntaxHighlightingEnabled);
  });
  lineNumbersToggle.addEventListener("click", () => {
    applyEditorLineNumbers(!editorLineNumbersEnabled);
  });

  copyMarkdownBtn.addEventListener("click", copyMarkdownToClipboard);
  copyHtmlBtn.addEventListener("click", copyHtmlToClipboard);
  importBtn.addEventListener("click", importFile);
  exportBtn.addEventListener("click", exportAsMarkdownFile);
  dbConnectBtn.addEventListener("click", connectDatabase);
  dbDisconnectBtn.addEventListener("click", disconnectDatabase);

  // Custom Context Menu Events
  document.addEventListener("contextmenu", showContextMenu);
  document.addEventListener("click", hideContextMenu);
  window.addEventListener("blur", hideContextMenu);
  window.addEventListener("pagehide", persistLocalMirrorBeforePageExit);

  ctxCutBtn.addEventListener("click", handleContextCut);
  ctxCopyBtn.addEventListener("click", handleContextCopy);
  ctxPasteBtn.addEventListener("click", handleContextPaste);
  ctxInsertBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = ctxInsertGroup.classList.toggle("open");
    ctxInsertBtn.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) ctxInsertMenu.querySelector("button")?.focus();
  });
  ctxInsertMenu.addEventListener("click", (event) => {
    const item = event.target.closest("[data-markdown-template]");
    if (item) handleContextInsert(item.dataset.markdownTemplate);
  });
  ctxInsertMenu.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    ctxInsertGroup.classList.remove("open");
    ctxInsertBtn.setAttribute("aria-expanded", "false");
    ctxInsertBtn.focus();
  });
  ctxSelectAllBtn.addEventListener("click", handleContextSelectAll);
  ctxFindBtn.addEventListener("click", handleContextFind);
  ctxOpenSideBtn.addEventListener("click", () => {
    hideContextMenu();
    if (contextMenuNoteId) {
      openNoteInSecondaryPane(contextMenuNoteId);
    }
  });
  ctxPinBtn.addEventListener("click", () => {
    hideContextMenu();
    if (contextMenuNoteId) {
      toggleNotePinned(contextMenuNoteId);
    }
  });
  ctxMoveUpBtn.addEventListener("click", () => {
    hideContextMenu();
    if (contextMenuNoteId) {
      moveNoteUp(contextMenuNoteId);
    }
  });
  ctxMoveDownBtn.addEventListener("click", () => {
    hideContextMenu();
    if (contextMenuNoteId) {
      moveNoteDown(contextMenuNoteId);
    }
  });

  // Find & Replace Widget events
  findInput.addEventListener("input", runFind);
  findInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        findPrev();
      } else {
        findNext();
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      hideFindBar();
    }
  });
  findPrevBtn.addEventListener("click", findPrev);
  findNextBtn.addEventListener("click", findNext);
  findCloseBtn.addEventListener("click", hideFindBar);
  findResultsToggleBtn.addEventListener("click", () => toggleFindResults());
  findResultsCloseBtn.addEventListener("click", () => {
    toggleFindResults(false);
    findInput.focus();
  });
  findAllNotesToggleBtn.addEventListener("click", toggleFindAllNotesMode);
  findResultsList.addEventListener("click", handleFindResultClick);
  findResultsList.addEventListener("keydown", handleFindResultKeydown);
  findToggleReplaceBtn.addEventListener("click", () => toggleReplace());
  findCaseToggleBtn.addEventListener("click", toggleMatchCaseMode);
  findExactToggleBtn.addEventListener("click", toggleExactMatchMode);
  findRegexToggleBtn.addEventListener("click", toggleRegexMode);
  
  replaceInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      replaceOne();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      hideFindBar();
    }
  });
  replaceOneBtn.addEventListener("click", replaceOne);
  replaceAllBtn.addEventListener("click", replaceAll);

  // Shortcuts
  document.addEventListener("keydown", (e) => {
    const isMeta = e.metaKey || e.ctrlKey;
    const isShift = e.shiftKey;

    if (isThemeModalOpen && e.key === "Tab" && !isMeta && !e.altKey) {
      const focusable = [...themeModal.querySelectorAll("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")]
        .filter((element) => element.offsetParent !== null);
      if (focusable.length > 0) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if ((isShift && document.activeElement === first) || (!isShift && document.activeElement === last)) {
          e.preventDefault();
          (isShift ? last : first).focus();
        }
      }
    }

    if (isHelpModalOpen && e.key === "Tab" && !isMeta && !e.altKey) {
      e.preventDefault();
      cycleHelpTab(isShift);
      return;
    }

    if (isAboutModalOpen && e.key === "Tab" && !isMeta && !e.altKey) {
      trapModalFocus(e, aboutModal);
      return;
    }

    if (isMeta && !e.altKey && (e.key === "+" || e.key === "=")) {
      e.preventDefault();
      applyEditorZoom(stepEditorZoom(currentEditorZoom, 1));
      return;
    }
    if (isMeta && !e.altKey && (e.key === "-" || e.key === "_")) {
      e.preventDefault();
      applyEditorZoom(stepEditorZoom(currentEditorZoom, -1));
      return;
    }
    if (isMeta && !e.altKey && e.key === "0") {
      e.preventDefault();
      applyEditorZoom(DEFAULT_EDITOR_ZOOM);
      return;
    }

    // Disable browser inspect shortcuts and accidental page reloads (F12, Cmd+Opt+I, Ctrl+Shift+I, Cmd+R)
    if (
      e.key === "F12" ||
      (isMeta && e.altKey && e.key.toLowerCase() === "i") ||
      (isMeta && isShift && e.key.toLowerCase() === "i") ||
      (isMeta && e.key.toLowerCase() === "r")
    ) {
      e.preventDefault();
    }

    if (isMeta && e.key === "b") {
      e.preventDefault();
      toggleSidebar();
    }
    if (isMeta && e.key === "n") {
      e.preventDefault();
      createNote();
    }
    if (isMeta && e.key === "f") {
      e.preventDefault();
      toggleFindBar();
    }
    if (isMeta && e.key === "h") {
      e.preventDefault();
      toggleFindBar(true);
    }
    if (e.altKey && e.key.toLowerCase() === "r" && isFindBarOpen) {
      e.preventDefault();
      toggleRegexMode();
    }
    if (e.altKey && e.key.toLowerCase() === "c" && isFindBarOpen) {
      e.preventDefault();
      toggleMatchCaseMode();
    }
    if (e.altKey && e.key.toLowerCase() === "w" && isFindBarOpen) {
      e.preventDefault();
      toggleExactMatchMode();
    }
    if (isMeta && (e.key === "\\" || e.key === "|")) {
      e.preventDefault();
      toggleSplitNoteMode();
    }
    if ((isMeta && (e.key === "/" || e.key === "?")) || e.key === "F1") {
      e.preventDefault();
      toggleHelpModal();
    }
    if (e.altKey && e.key === "ArrowUp") {
      e.preventDefault();
      moveNoteUp();
    }
    if (e.altKey && e.key === "ArrowDown") {
      e.preventDefault();
      moveNoteDown();
    }
    if (isMeta && isShift && e.key.toLowerCase() === "f") {
      e.preventDefault();
      toggleFocusMode();
    }
    if (e.key === "Escape") {
      if (isAboutModalOpen) {
        e.preventDefault();
        closeAboutModal();
      } else if (isThemeModalOpen) {
        e.preventDefault();
        closeThemeModal();
      } else if (isHelpModalOpen) {
        e.preventDefault();
        closeHelpModal();
      } else if (isFindBarOpen) {
        e.preventDefault();
        hideFindBar();
      } else if (isFocusMode) {
        toggleFocusMode();
      }
    }
  });

  // Sync scrolling of Edit & Preview in Split mode + Backdrop scroll always
  editorTextarea.addEventListener("scroll", () => {
    editorBackdrop.scrollTop = editorTextarea.scrollTop;
    editorLineNumbers.scrollTop = editorTextarea.scrollTop;

    if (currentLayoutMode !== "split") return;
    
    const editScrollHeight = editorTextarea.scrollHeight - editorTextarea.clientHeight;
    if (editScrollHeight <= 0) return;
    
    const percentage = editorTextarea.scrollTop / editScrollHeight;
    const previewScrollHeight = markdownPreview.scrollHeight - markdownPreview.clientHeight;
    
    markdownPreview.scrollTop = percentage * previewScrollHeight;
  });

  secondaryEditorTextarea.addEventListener("scroll", () => {
    secondaryEditorBackdrop.scrollTop = secondaryEditorTextarea.scrollTop;
    secondaryEditorLineNumbers.scrollTop = secondaryEditorTextarea.scrollTop;

    if (currentLayoutMode !== "split") return;
    
    const editScrollHeight = secondaryEditorTextarea.scrollHeight - secondaryEditorTextarea.clientHeight;
    if (editScrollHeight <= 0) return;
    
    const percentage = secondaryEditorTextarea.scrollTop / editScrollHeight;
    const previewScrollHeight = secondaryMarkdownPreview.scrollHeight - secondaryMarkdownPreview.clientHeight;
    
    secondaryMarkdownPreview.scrollTop = percentage * previewScrollHeight;
  });
}

// ----------------------------------------------------
// Utilities
// ----------------------------------------------------
// Sanitized Markdown links carry target="_blank", but the desktop webview has
// no default handling for it, so clicking one would otherwise do nothing. Send
// external links to the user's browser; everything else stays put.
function handlePreviewLinkClick(event) {
  const link = event.target.closest("a[href]");
  if (!link) return;

  event.preventDefault();
  const action = resolveLinkAction(link.getAttribute("href"));
  if (action.kind !== "external") return;

  if (!window.__TAURI__) {
    window.open(action.url, "_blank", "noopener,noreferrer");
    return;
  }

  invoke("plugin:opener|open_url", { url: action.url }).catch(error => {
    console.error("Failed to open a link in the browser", error);
    showNotification("Could not open that link");
  });
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// Database helpers
function loadNotesFromLocalStorage() {
  const savedNotes = localStorage.getItem(LOCAL_NOTES_KEY);
  if (savedNotes) {
    try {
      notes = normalizePinnedNoteOrder(JSON.parse(savedNotes));
    } catch (e) {
      console.error("Failed to parse saved notes, resetting", e);
      notes = [];
    }
  }
}

// Notes set aside by an earlier build of this branch, when local storage was
// shared between the local-only collection and the active workspace. Folded
// back in once so nothing is stranded; can be dropped after a release carries
// the current storage layout.
function adoptLegacyStashedNotes() {
  let stashed = null;
  try {
    stashed = readStoredNotes(localStorage.getItem(LOCAL_NOTES_BACKUP_KEY));
  } catch (error) {
    console.error("Failed to read previously set-aside notes", error);
    return false;
  }
  if (!stashed) return false;

  const byId = new Map(stashed.map(note => [note.id, note]));
  notes.forEach(note => {
    const held = byId.get(note.id);
    if (!held || (note.updatedAt || 0) >= (held.updatedAt || 0)) byId.set(note.id, note);
  });
  notes = normalizePinnedNoteOrder([...byId.values()]);

  const merged = persistNotesLocally(localStorage, notes);
  if (!merged.ok) {
    console.error("Failed to fold previously set-aside notes back in", merged.error);
    return false;
  }

  try {
    localStorage.removeItem(LOCAL_NOTES_BACKUP_KEY);
  } catch (error) {
    console.error("Failed to clear previously set-aside notes", error);
  }
  return true;
}

function updateDbUiState(isConnected) {
  if (isConnected && activeDbPath) {
    dbConnectBtn.style.display = "none";
    dbDisconnectBtn.style.display = "block";
    
    const fileName = activeDbPath.split(/[/\\]/).pop();
    workspaceMenuValue.textContent = fileName;
    workspaceMenuValue.title = activeDbPath;
    saveStatus.textContent = `Saved (${fileName})`;
    saveStatus.title = `Workspace: ${activeDbPath}`;
  } else {
    dbConnectBtn.style.display = "block";
    dbDisconnectBtn.style.display = "none";
    workspaceMenuValue.textContent = "Local notes";
    workspaceMenuValue.title = "Notes stored in local webview storage";
    
    saveStatus.textContent = "Saved";
    saveStatus.title = "Saved to local webview storage";
  }
}

async function connectDatabase() {
  if (!window.__TAURI__) {
    showNotification("Workspaces are only available in the desktop app");
    return;
  }

  let path;
  try {
    path = await invoke("select_db_file");
  } catch (err) {
    showNotification("Database selection failed: " + err);
    return;
  }
  if (!path) return;

  const localNotes = readStoredNotes(localStorage.getItem(LOCAL_NOTES_KEY));

  // Load into a local until the switch is known to be safe, so a failure here
  // leaves the active collection untouched.
  let workspaceNotes;
  try {
    workspaceNotes = await invoke("load_db_notes", { dbPath: path });
  } catch (err) {
    console.error("Failed to read SQLite database", err);
    showNotification("Could not open workspace; using local notes");
    return;
  }

  // Seeding deletes and rewrites the workspace's rows, so an unreadable
  // response must not be mistaken for an empty workspace.
  if (!Array.isArray(workspaceNotes)) {
    console.error("Workspace returned an unexpected response", workspaceNotes);
    showNotification("Could not open workspace; using local notes");
    return;
  }

  activeDbPath = path;

  // The local-only collection stays where it is. Nothing needs setting aside,
  // because a workspace session no longer writes to local storage at all.
  if (workspaceNotes.length > 0) {
    notes = normalizePinnedNoteOrder(workspaceNotes);
  } else if (localNotes) {
    // Seed an empty workspace with the notes already in the app.
    notes = normalizePinnedNoteOrder(localNotes);
    try {
      await invoke("save_notes_db", { dbPath: path, notes });
    } catch (err) {
      console.error("Failed to seed notes to SQLite DB", err);
    }
  }

  let preferenceSaved = true;
  try {
    await invoke("set_last_workspace", { dbPath: path });
    localStorage.removeItem("scratchpad_active_db");
  } catch (err) {
    preferenceSaved = false;
    console.error("Failed to remember workspace", err);
  }

  updateDbUiState(true);
  if (notes.length === 0) {
    createNote();
  } else {
    activeNoteId = notes[0].id;
    renderNoteList();
    loadActiveNote();
  }

  showNotification(preferenceSaved
    ? "Workspace connected!"
    : "Workspace connected, but could not be remembered");
}

async function disconnectDatabase() {
  activeDbPath = null;
  localStorage.removeItem("scratchpad_active_db");

  // The local-only collection was never written over while the workspace was
  // connected, so it is simply still there.
  loadNotesFromLocalStorage();

  if (notes.length === 0) {
    createNote();
  } else {
    activeNoteId = notes[0].id;
    renderNoteList();
    loadActiveNote();
  }
  
  updateDbUiState(false);
  try {
    if (window.__TAURI__) {
      await invoke("set_last_workspace", { dbPath: null });
    }
    showNotification("Workspace disconnected; using local notes");
  } catch (err) {
    console.error("Failed to forget workspace", err);
    showNotification("Disconnected, but the workspace preference could not be cleared");
  }
}

// Find & Replace Widget functions
function toggleFindBar(openReplace = false) {
  if (isFindBarOpen) {
    if (openReplace && !isReplaceOpen) {
      toggleReplace(true);
    } else if (!openReplace) {
      hideFindBar();
    }
  } else {
    isFindBarOpen = true;
    findBar.style.display = "flex";
    
    if (openReplace) {
      toggleReplace(true);
    }
    
    // Check if there is selected text in the textarea, prefill the find input
    const selection = editorTextarea.value.substring(editorTextarea.selectionStart, editorTextarea.selectionEnd);
    if (selection) {
      findInput.value = selection;
    }
    
    if (openReplace && isReplaceOpen) {
      replaceInput.focus();
      replaceInput.select();
    } else {
      findInput.focus();
      findInput.select();
    }
    runFind();
  }
}

function hideFindBar() {
  isFindBarOpen = false;
  clearTimeout(highlightRedrawTimer);
  clearTimeout(highlightSettledRedrawTimer);
  highlightRedrawTimer = null;
  highlightSettledRedrawTimer = null;
  toggleFindResults(false);
  findBar.style.display = "none";
  findMatches = [];
  activeMatchIndex = -1;
  hasInvalidFindPattern = false;
  findInput.value = "";
  replaceInput.value = "";
  toggleReplace(false);
  updateFindCount();
  updateHighlights();
  editorTextarea.focus();
}

function toggleReplace(forceState) {
  isReplaceOpen = typeof forceState === "boolean" ? forceState : !isReplaceOpen;
  replaceRow.style.display = isReplaceOpen ? "flex" : "none";
  findToggleReplaceBtn.classList.toggle("expanded", isReplaceOpen);
  findToggleReplaceBtn.setAttribute("aria-expanded", String(isReplaceOpen));
  if (isReplaceOpen) {
    replaceInput.focus();
  }
}

function toggleRegexMode() {
  isRegexMode = !isRegexMode;
  findRegexToggleBtn.classList.toggle("active", isRegexMode);
  findRegexToggleBtn.setAttribute("aria-pressed", String(isRegexMode));
  runFind();
}

function toggleMatchCaseMode() {
  isMatchCaseMode = !isMatchCaseMode;
  findCaseToggleBtn.classList.toggle("active", isMatchCaseMode);
  findCaseToggleBtn.setAttribute("aria-pressed", String(isMatchCaseMode));
  runFind();
}

function toggleExactMatchMode() {
  isExactMatchMode = !isExactMatchMode;
  findExactToggleBtn.classList.toggle("active", isExactMatchMode);
  findExactToggleBtn.setAttribute("aria-pressed", String(isExactMatchMode));
  runFind();
}

function getFindOptions() {
  return {
    useRegex: isRegexMode,
    matchCase: isMatchCaseMode,
    exactMatch: isExactMatchMode
  };
}

function runFind({ preserveActive = false, selectActive = true } = {}) {
  const query = findInput.value;
  const previousActiveIndex = activeMatchIndex;
  findInput.classList.remove("invalid-regex");

  const result = findTextMatches(editorTextarea.value, query, getFindOptions());
  findMatches = result.matches;
  hasInvalidFindPattern = result.invalidPattern;

  if (hasInvalidFindPattern) {
    activeMatchIndex = -1;
    findInput.classList.add("invalid-regex");
    updateFindCount("Invalid");
    updateFindResultsToggle();
    updateHighlights();
    renderFindResults();
    return;
  }

  if (findMatches.length > 0) {
    activeMatchIndex = preserveActive && previousActiveIndex >= 0
      ? Math.min(previousActiveIndex, findMatches.length - 1)
      : 0;

    if (selectActive) {
      selectMatch(activeMatchIndex, false); // Do not steal focus from search input
    } else {
      updateFindCount();
      updateHighlights();
      renderFindResults();
    }
  } else {
    activeMatchIndex = -1;
    updateFindCount();
    updateHighlights();
    renderFindResults();
  }

  updateFindResultsToggle();
}

function selectMatch(index, focusEditor = false) {
  if (index < 0 || index >= findMatches.length) return;
  activeMatchIndex = index;
  const match = findMatches[index];
  
  const editorIsVisible = currentLayoutMode !== "preview" || isSplitNoteMode;
  if (focusEditor && editorIsVisible) {
    editorTextarea.focus();
  }
  editorTextarea.setSelectionRange(match.start, match.end);
  updateCursorPositionForText(editorTextarea);

  updateFindCount();
  updateHighlights();
  scrollActiveMatchIntoView(match);
  renderFindResults();
}

function scrollActiveMatchIntoView(match) {
  // The backdrop has the same typography, padding, wrapping, and width as the
  // textarea, so its active mark gives us the real visual position. Counting
  // newline characters is not enough when a long Markdown line wraps.
  const activeHighlight = editorBackdrop.querySelector("mark.active-match");

  if (activeHighlight) {
    const viewportOffset = Math.min(editorTextarea.clientHeight * 0.3, 160);
    editorTextarea.scrollTop = Math.max(0, activeHighlight.offsetTop - viewportOffset);
  } else {
    const textBefore = editorTextarea.value.slice(0, match.start);
    const lineCountBefore = textBefore.split("\n").length;
    const lineHeight = parseFloat(window.getComputedStyle(editorTextarea).lineHeight) || 20;
    editorTextarea.scrollTop = Math.max(0, (lineCountBefore - 3) * lineHeight);
  }

  editorBackdrop.scrollTop = editorTextarea.scrollTop;

  if (currentLayoutMode !== "edit" && !isSplitNoteMode) {
    const previewHighlight = markdownPreview.querySelector("mark.active-match");
    previewHighlight?.scrollIntoView?.({ block: "center", inline: "nearest" });
  }
}

function findNext() {
  if (findMatches.length === 0) return;
  const nextIndex = (activeMatchIndex + 1) % findMatches.length;
  selectMatch(nextIndex);
}

function findPrev() {
  if (findMatches.length === 0) return;
  const prevIndex = (activeMatchIndex - 1 + findMatches.length) % findMatches.length;
  selectMatch(prevIndex);
}

function replaceOne() {
  if (findMatches.length === 0 || activeMatchIndex < 0) return;
  const match = findMatches[activeMatchIndex];
  const replaceText = replaceInput.value;
  const text = editorTextarea.value;
  
  let replacement = replaceText;
  if (isRegexMode) {
    try {
      const regex = new RegExp(findInput.value, isMatchCaseMode ? "" : "i");
      replacement = match.text.replace(regex, replaceText);
    } catch (e) {}
  }
  
  const newContent = text.substring(0, match.start) + replacement + text.substring(match.end);
  editorTextarea.value = newContent;
  
  // Keep active note updated
  const activeNote = notes.find(n => n.id === activeNoteId);
  if (activeNote) {
    activeNote.content = newContent;
    activeNote.updatedAt = Date.now();
    saveNotesToStorage();
    renderNoteList(searchInput.value);
    updateMarkdownPreview();
    updateWordCharCount();
  }
  
  const targetIndex = activeMatchIndex;
  runFind();
  if (findMatches.length > 0) {
    selectMatch(Math.min(targetIndex, findMatches.length - 1), false);
  }
}

function replaceAll() {
  if (findMatches.length === 0) return;
  const query = findInput.value;
  const replaceText = replaceInput.value;
  const text = editorTextarea.value;
  const totalMatches = findMatches.length;
  
  let newContent = text;
  let replacementRegex = null;
  if (isRegexMode) {
    try {
      replacementRegex = new RegExp(query, isMatchCaseMode ? "" : "i");
    } catch (e) {
      return;
    }
  }

  for (let index = findMatches.length - 1; index >= 0; index -= 1) {
    const match = findMatches[index];
    const replacement = replacementRegex
      ? match.text.replace(replacementRegex, replaceText)
      : replaceText;
    newContent = newContent.substring(0, match.start) +
      replacement +
      newContent.substring(match.end);
  }
  
  editorTextarea.value = newContent;
  
  const activeNote = notes.find(n => n.id === activeNoteId);
  if (activeNote) {
    activeNote.content = newContent;
    activeNote.updatedAt = Date.now();
    saveNotesToStorage();
    renderNoteList(searchInput.value);
    updateMarkdownPreview();
    updateWordCharCount();
  }
  
  showNotification(`Replaced ${totalMatches} occurrences`);
  runFind();
}

function updateFindCount(customText) {
  if (customText) {
    findCount.textContent = customText;
  } else if (findMatches.length === 0) {
    findCount.textContent = "0 of 0";
  } else {
    findCount.textContent = `${activeMatchIndex + 1} of ${findMatches.length}`;
  }
}

function updateFindResultsToggle() {
  findResultsToggleBtn.disabled = !findInput.value || hasInvalidFindPattern;
}

function toggleFindResults(forceState) {
  const shouldOpen = typeof forceState === "boolean" ? forceState : !isFindResultsOpen;
  if (shouldOpen && (!findInput.value || hasInvalidFindPattern)) return;

  if (shouldOpen && isSplitNoteMode) {
    const previousFocus = document.activeElement;
    toggleSplitNoteMode(false);
    previousFocus?.focus?.({ preventScroll: true });
  }

  isFindResultsOpen = shouldOpen;
  panesContainer.classList.toggle("find-results-mode", shouldOpen);
  findResultsPane.style.display = shouldOpen ? "flex" : "none";
  findResultsToggleBtn.classList.toggle("active", shouldOpen);
  findResultsToggleBtn.setAttribute("aria-expanded", String(shouldOpen));

  if (shouldOpen) {
    renderFindResults();
  } else {
    findResultsList.replaceChildren();
  }

  scheduleFindHighlightRedraw(220);
}

function toggleFindAllNotesMode() {
  isFindAllNotesMode = !isFindAllNotesMode;
  findAllNotesToggleBtn.classList.toggle("active", isFindAllNotesMode);
  findAllNotesToggleBtn.setAttribute("aria-pressed", String(isFindAllNotesMode));
  renderFindResults();
}

function getFindResultEntries() {
  if (!isFindAllNotesMode) {
    const activeNote = notes.find((note) => note.id === activeNoteId);
    if (!activeNote) return [];
    return findMatches.map((match, matchIndex) => ({ activeNote, match, matchIndex }));
  }

  return notes.flatMap((note) => {
    const result = findTextMatches(note.content || "", findInput.value, getFindOptions());
    return result.matches.map((match, matchIndex) => ({
      activeNote: note,
      match,
      matchIndex
    }));
  });
}

function renderFindResults() {
  if (!isFindResultsOpen) return;

  const resultEntries = getFindResultEntries();
  const matchLabel = resultEntries.length === 1 ? "match" : "matches";
  if (isFindAllNotesMode && resultEntries.length > 0) {
    const noteCount = new Set(resultEntries.map(({ activeNote }) => activeNote.id)).size;
    const noteLabel = noteCount === 1 ? "note" : "notes";
    findResultsSummary.textContent = `${resultEntries.length} ${matchLabel} in ${noteCount} ${noteLabel}`;
  } else {
    findResultsSummary.textContent = `${resultEntries.length} ${matchLabel}`;
  }
  findResultsList.replaceChildren();

  let emptyMessage = "";
  if (!findInput.value) {
    emptyMessage = "Enter a search term to see every match.";
  } else if (hasInvalidFindPattern) {
    emptyMessage = "Fix the regular expression to show results.";
  } else if (resultEntries.length === 0) {
    emptyMessage = isFindAllNotesMode
      ? "No matches in any scratchpad."
      : "No matches in this scratchpad.";
  }

  if (emptyMessage) {
    const item = document.createElement("li");
    item.className = "find-results-empty";
    item.textContent = emptyMessage;
    findResultsList.appendChild(item);
    return;
  }

  const fragment = document.createDocumentFragment();
  const hasActiveEntry = resultEntries.some(({ activeNote, matchIndex }) =>
    activeNote.id === activeNoteId && matchIndex === activeMatchIndex
  );

  resultEntries.forEach(({ activeNote, match, matchIndex }, index) => {
    const item = document.createElement("li");
    item.className = "find-result-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "find-result-button";
    button.dataset.noteId = activeNote.id;
    button.dataset.matchIndex = String(matchIndex);
    button.dataset.matchStart = String(match.start);
    button.dataset.matchEnd = String(match.end);
    const isActive = activeNote.id === activeNoteId && matchIndex === activeMatchIndex;
    button.tabIndex = isActive || (!hasActiveEntry && index === 0) ? 0 : -1;
    const noteContext = isFindAllNotesMode ? `${activeNote.title}, ` : "";
    button.setAttribute(
      "aria-label",
      `Match ${index + 1} of ${resultEntries.length}, ${noteContext}line ${match.line}, column ${match.column}: ${match.snippet}`
    );

    if (isActive) {
      button.classList.add("active");
      button.setAttribute("aria-current", "true");
    }

    const location = document.createElement("span");
    location.className = "find-result-location";
    location.textContent = `Line ${match.line}`;
    location.title = `Line ${match.line}, column ${match.column}`;

    const snippet = document.createElement("span");
    snippet.className = "find-result-snippet";
    snippet.textContent = match.snippet;
    snippet.title = match.snippet;

    const content = document.createElement("span");
    content.className = "find-result-content";
    if (isFindAllNotesMode) {
      const noteTitle = document.createElement("span");
      noteTitle.className = "find-result-note";
      noteTitle.textContent = activeNote.title;
      noteTitle.title = activeNote.title;
      content.appendChild(noteTitle);
    }
    content.appendChild(snippet);

    button.append(location, content);
    item.appendChild(button);
    fragment.appendChild(item);
  });

  findResultsList.appendChild(fragment);
  const activeResult = findResultsList.querySelector("[aria-current='true']");
  activeResult?.scrollIntoView?.({ block: "nearest" });
}

function handleFindResultClick(event) {
  const button = event.target.closest(".find-result-button");
  if (!button) return;
  activateFindResult(button, true);
}

function activateFindResult(button, focusEditor) {
  const noteId = button.dataset.noteId;
  const matchStart = Number(button.dataset.matchStart);
  const matchEnd = Number(button.dataset.matchEnd);

  if (noteId !== activeNoteId) {
    activeNoteId = noteId;
    renderNoteList(searchInput.value);
    loadActiveNote();
  }

  const matchIndex = findMatches.findIndex(
    (match) => match.start === matchStart && match.end === matchEnd
  );
  if (matchIndex >= 0) selectMatch(matchIndex, focusEditor);
}

function handleFindResultKeydown(event) {
  const button = event.target.closest(".find-result-button");
  const buttons = [...findResultsList.querySelectorAll(".find-result-button")];
  if (!button || buttons.length === 0) return;

  const currentIndex = buttons.indexOf(button);
  let targetIndex = currentIndex;

  if (event.key === "ArrowDown") {
    targetIndex = (currentIndex + 1) % buttons.length;
  } else if (event.key === "ArrowUp") {
    targetIndex = (currentIndex - 1 + buttons.length) % buttons.length;
  } else if (event.key === "Home") {
    targetIndex = 0;
  } else if (event.key === "End") {
    targetIndex = buttons.length - 1;
  } else {
    return;
  }

  event.preventDefault();
  const target = buttons[targetIndex];
  const noteId = target.dataset.noteId;
  const matchStart = target.dataset.matchStart;
  activateFindResult(target, false);
  [...findResultsList.querySelectorAll(".find-result-button")]
    .find((result) => result.dataset.noteId === noteId && result.dataset.matchStart === matchStart)
    ?.focus();
}

function clearPreviewHighlights() {
  if (!previewHighlightsRendered) return;

  markdownPreview.querySelectorAll("mark.find-preview-match").forEach((highlight) => {
    highlight.replaceWith(document.createTextNode(highlight.textContent));
  });
  markdownPreview.normalize();
  previewHighlightsRendered = false;
}

function updatePreviewHighlights() {
  clearPreviewHighlights();

  if (
    currentLayoutMode === "edit" ||
    isSplitNoteMode ||
    !isFindBarOpen ||
    !findInput.value ||
    hasInvalidFindPattern ||
    findMatches.length === 0
  ) {
    return;
  }

  const textNodes = [];
  const walker = document.createTreeWalker(
    markdownPreview,
    window.NodeFilter.SHOW_TEXT
  );
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);

  let previewMatchIndex = 0;
  textNodes.forEach((textNode) => {
    const nodeMatches = findTextMatches(
      textNode.nodeValue,
      findInput.value,
      getFindOptions()
    ).matches
      .map((match) => ({ ...match, previewIndex: previewMatchIndex++ }));

    for (let index = nodeMatches.length - 1; index >= 0; index -= 1) {
      const match = nodeMatches[index];
      textNode.splitText(match.end);
      const matchedText = textNode.splitText(match.start);
      const highlight = document.createElement("mark");

      highlight.className = "find-preview-match";
      highlight.dataset.findIndex = String(match.previewIndex);
      highlight.textContent = matchedText.nodeValue;
      if (match.previewIndex === activeMatchIndex) {
        highlight.classList.add("active-match");
      }

      matchedText.replaceWith(highlight);
      previewHighlightsRendered = true;
    }
  });
}

function scheduleFindHighlightRedraw(delay = 0) {
  if (!isFindBarOpen) return;

  clearTimeout(highlightRedrawTimer);
  clearTimeout(highlightSettledRedrawTimer);

  highlightRedrawTimer = setTimeout(() => redrawFindHighlights(), delay);
  // A packaged webview can report the new dimensions before native layout and
  // paint have completely settled. Redraw once promptly and once after that
  // transition window so highlights cannot retain the intermediate wrapping.
  highlightSettledRedrawTimer = setTimeout(
    () => redrawFindHighlights(),
    Math.max(delay + 80, 260)
  );
}

function redrawFindHighlights() {
  if (!isFindBarOpen) return;

  const redraw = () => {
    if (!isFindBarOpen) return;
    updateHighlights();
    if (activeMatchIndex >= 0 && activeMatchIndex < findMatches.length) {
      scrollActiveMatchIntoView(findMatches[activeMatchIndex]);
    }
  };

  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(redraw);
  } else {
    redraw();
  }
}

function updateHighlights() {
  primaryEditorRenderScheduler.cancel();
  const text = editorTextarea.value;
  const query = findInput.value;

  updateEditorLineNumberGutter(editorTextarea, editorLineNumbers, editorWrapper);

  updatePreviewHighlights();
  
  if (!isFindBarOpen || !query || findMatches.length === 0) {
    editorBackdrop.innerHTML = renderEditorBackdrop(text, {
      syntaxEnabled: syntaxHighlightingEnabled
    });
    return;
  }

  editorBackdrop.innerHTML = renderEditorBackdrop(text, {
    syntaxEnabled: syntaxHighlightingEnabled,
    matches: findMatches,
    activeMatchIndex
  });
}

// ----------------------------------------------------
// Custom Context Menu Logic
// ----------------------------------------------------
function showContextMenu(e, noteId = null) {
  e.preventDefault();
  let hasInsertMenu = false;
  
  if (noteId) {
    contextMenuNoteId = noteId;
    ctxOpenSideBtn.style.display = "flex";
    ctxSidebarDivider.style.display = "block";
    ctxPinBtn.style.display = "flex";
    ctxMoveUpBtn.style.display = "flex";
    ctxMoveDownBtn.style.display = "flex";
    
    const noteIndex = notes.findIndex(n => n.id === noteId);
    const note = notes[noteIndex];
    ctxPinBtn.querySelector("span").textContent = isNotePinned(note) ? "Unpin from Top" : "Pin to Top";
    ctxMoveUpBtn.disabled = !canMoveNote(notes, noteIndex, -1);
    ctxMoveDownBtn.disabled = !canMoveNote(notes, noteIndex, 1);
    
    ctxCutBtn.style.display = "none";
    ctxCopyBtn.style.display = "none";
    ctxPasteBtn.style.display = "none";
    ctxSelectAllBtn.style.display = "none";
    ctxFindBtn.style.display = "none";
    ctxInsertDivider.style.display = "none";
    ctxInsertGroup.style.display = "none";
  } else {
    contextMenuNoteId = null;
    ctxOpenSideBtn.style.display = "none";
    ctxSidebarDivider.style.display = "none";
    ctxPinBtn.style.display = "none";
    ctxMoveUpBtn.style.display = "none";
    ctxMoveDownBtn.style.display = "none";
    
    ctxCutBtn.style.display = "flex";
    ctxCopyBtn.style.display = "flex";
    ctxPasteBtn.style.display = "flex";
    ctxSelectAllBtn.style.display = "flex";
    ctxFindBtn.style.display = "flex";
    
    const target = e.target.closest("textarea, input[type='text'], .markdown-preview");
    if (!target) {
      hideContextMenu();
      return;
    }
    
    contextMenuTarget = target;
    hasInsertMenu = target === editorTextarea || target === secondaryEditorTextarea;
    ctxInsertDivider.style.display = hasInsertMenu ? "block" : "none";
    ctxInsertGroup.style.display = hasInsertMenu ? "block" : "none";
    
    let hasSelection = false;
    if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
      hasSelection = target.selectionStart !== target.selectionEnd;
    } else {
      hasSelection = Boolean(window.getSelection().toString());
    }
    
    ctxCutBtn.disabled = !hasSelection;
    ctxCopyBtn.disabled = !hasSelection;
  }
  
  const menuWidth = 180;
  const menuHeight = noteId ? 180 : (hasInsertMenu ? 285 : 220);
  const submenuWidth = 175;
  let x = e.clientX;
  let y = e.clientY;
  
  if (x + menuWidth > window.innerWidth) {
    x = window.innerWidth - menuWidth - 8;
  }
  if (y + menuHeight > window.innerHeight) {
    y = window.innerHeight - menuHeight - 8;
  }
  
  customContextMenu.style.left = `${Math.max(8, x)}px`;
  customContextMenu.style.top = `${Math.max(8, y)}px`;
  customContextMenu.classList.toggle(
    "submenu-opens-left",
    x + menuWidth + submenuWidth + 8 > window.innerWidth
  );
  customContextMenu.style.display = "flex";
}

function hideContextMenu() {
  customContextMenu.style.display = "none";
  ctxInsertGroup.classList.remove("open");
  ctxInsertBtn.setAttribute("aria-expanded", "false");
}

function handleContextInsert(templateName) {
  const target = contextMenuTarget;
  if (target !== editorTextarea && target !== secondaryEditorTextarea) return;

  const edit = getMarkdownTemplateEdit(
    target.value,
    target.selectionStart,
    target.selectionEnd,
    templateName
  );
  if (!edit) return;

  hideContextMenu();
  target.focus({ preventScroll: true });
  applyEditorEdit(target, edit);
}

async function handleContextCut() {
  if (!contextMenuTarget) return;
  hideContextMenu();
  
  if (contextMenuTarget.tagName === "TEXTAREA" || contextMenuTarget.tagName === "INPUT") {
    const start = contextMenuTarget.selectionStart;
    const end = contextMenuTarget.selectionEnd;
    const text = contextMenuTarget.value.substring(start, end);
    if (text) {
      await navigator.clipboard.writeText(text);
      contextMenuTarget.value = contextMenuTarget.value.substring(0, start) + contextMenuTarget.value.substring(end);
      contextMenuTarget.selectionStart = contextMenuTarget.selectionEnd = start;
      contextMenuTarget.dispatchEvent(new Event("input"));
    }
  }
}

async function handleContextCopy() {
  if (!contextMenuTarget) return;
  hideContextMenu();
  
  let text = "";
  if (contextMenuTarget.tagName === "TEXTAREA" || contextMenuTarget.tagName === "INPUT") {
    text = contextMenuTarget.value.substring(contextMenuTarget.selectionStart, contextMenuTarget.selectionEnd);
  } else {
    text = window.getSelection().toString();
  }
  
  if (text) {
    await navigator.clipboard.writeText(text);
  }
}

async function handleContextPaste() {
  if (!contextMenuTarget) return;
  hideContextMenu();
  
  try {
    const text = await navigator.clipboard.readText();
    if (text && (contextMenuTarget.tagName === "TEXTAREA" || contextMenuTarget.tagName === "INPUT")) {
      const start = contextMenuTarget.selectionStart;
      const end = contextMenuTarget.selectionEnd;
      contextMenuTarget.value = contextMenuTarget.value.substring(0, start) + text + contextMenuTarget.value.substring(end);
      contextMenuTarget.selectionStart = contextMenuTarget.selectionEnd = start + text.length;
      contextMenuTarget.dispatchEvent(new Event("input"));
    }
  } catch (err) {
    console.error("Paste failed", err);
  }
}

function handleContextSelectAll() {
  if (!contextMenuTarget) return;
  hideContextMenu();
  
  if (contextMenuTarget.tagName === "TEXTAREA" || contextMenuTarget.tagName === "INPUT") {
    contextMenuTarget.select();
  }
}

function handleContextFind() {
  hideContextMenu();
  toggleFindBar();
}

// ----------------------------------------------------
// Dual-Note Split View Functions
// ----------------------------------------------------
function toggleSplitNoteMode(forceState) {
  const shouldOpen = typeof forceState === "boolean" ? forceState : !isSplitNoteMode;
  if (shouldOpen && isFindResultsOpen) {
    toggleFindResults(false);
  }

  isSplitNoteMode = shouldOpen;
  splitNoteBtn.setAttribute("aria-pressed", String(isSplitNoteMode));
  
  if (isSplitNoteMode) {
    appContainer.classList.add("dual-note-active");
    panesContainer.classList.add("dual-split-mode");
    secondaryPaneWrapper.style.display = "flex";
    splitNoteBtn.classList.add("active");
    
    // Choose secondary note (different from activeNoteId if possible)
    if (!secondaryNoteId || secondaryNoteId === activeNoteId) {
      const otherNote = notes.find(n => n.id !== activeNoteId);
      secondaryNoteId = otherNote ? otherNote.id : activeNoteId;
    }
    
    populateSecondaryNoteSelect();
    loadSecondaryNote();
    showNotification("Dual-Note Split View enabled");
  } else {
    dismissNotification("Dual-Note Split View enabled");
    appContainer.classList.remove("dual-note-active");
    panesContainer.classList.remove("dual-split-mode");
    secondaryPaneWrapper.style.display = "none";
    splitNoteBtn.classList.remove("active");
    activePane = "primary";
    editorTextarea.focus();
  }

  scheduleFindHighlightRedraw(220);
}

function openNoteInSecondaryPane(noteId) {
  if (!noteId) return;
  secondaryNoteId = noteId;
  if (!isSplitNoteMode) {
    toggleSplitNoteMode(true);
  } else {
    populateSecondaryNoteSelect();
    loadSecondaryNote();
  }
  activePane = "secondary";
  setActivePane("secondary");
  secondaryEditorTextarea.focus();
}

function populateSecondaryNoteSelect() {
  secondaryNoteSelect.innerHTML = "";
  notes.forEach(note => {
    const opt = document.createElement("option");
    opt.value = note.id;
    opt.textContent = note.title || "Untitled Scratchpad";
    if (note.id === secondaryNoteId) {
      opt.selected = true;
    }
    secondaryNoteSelect.appendChild(opt);
  });
}

function loadSecondaryNote() {
  const note = notes.find(n => n.id === secondaryNoteId);
  if (!note) return;

  secondaryNoteTitle.value = note.title;
  secondaryEditorTextarea.value = note.content;

  updateSecondaryEditorBackdrop();
  updateSecondaryMarkdownPreview();
  if (secondaryNoteSelect.value !== note.id) {
    secondaryNoteSelect.value = note.id;
  }
}

function handleSecondaryEditorInput() {
  const note = notes.find(n => n.id === secondaryNoteId);
  if (!note) return;

  note.content = secondaryEditorTextarea.value;
  note.updatedAt = Date.now();
  updateCursorPositionForText(secondaryEditorTextarea);
  secondaryEditorRenderScheduler.schedule();

  // Auto-rename if not locked
  if (!note.isTitleLocked) {
    const firstLine = note.content.trim().split("\n")[0];
    if (firstLine && firstLine.length > 0) {
      const cleanTitle = firstLine.replace(/^#+\s*/, "").trim().substring(0, 40);
      if (cleanTitle) {
        note.title = cleanTitle;
        secondaryNoteTitle.value = cleanTitle;
        populateSecondaryNoteSelect();
      }
    }
  }

  triggerSavingState();

  scheduleNoteSave(note.id, () => {
    renderNoteList(searchInput.value);
  });

  clearTimeout(previewDebounceTimer);
  previewDebounceTimer = setTimeout(() => {
    updateSecondaryMarkdownPreview();
    if (activePane === "secondary") {
      updateWordCharCountForText(secondaryEditorTextarea);
    }
  }, 150);
}

function handleSecondaryTitleInput() {
  const note = notes.find(n => n.id === secondaryNoteId);
  if (!note) return;

  note.title = secondaryNoteTitle.value.trim() || "Untitled Scratchpad";
  note.isTitleLocked = true;
  note.updatedAt = Date.now();

  triggerSavingState();

  scheduleNoteSave(note.id, () => {
    renderNoteList(searchInput.value);
    populateSecondaryNoteSelect();
  });
}

function updateSecondaryMarkdownPreview() {
  if (currentLayoutMode === "edit") return;
  if (window.marked) {
    secondaryMarkdownPreview.innerHTML = renderMarkdown(secondaryEditorTextarea.value);
    highlightPreviewCode(secondaryMarkdownPreview, window.hljs, syntaxHighlightingEnabled);
  }
}

function setActivePane(pane) {
  activePane = pane;
  if (pane === "secondary") {
    primaryPaneWrapper.classList.remove("active-pane");
    secondaryPaneWrapper.classList.add("active-pane");
    updateWordCharCountForText(secondaryEditorTextarea);
  } else {
    primaryPaneWrapper.classList.add("active-pane");
    secondaryPaneWrapper.classList.remove("active-pane");
    updateWordCharCountForText(editorTextarea);
  }
}

function updateWordCharCountForText(el) {
  const text = el.value || "";
  const totalWords = text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
  const totalChars = text.length;
  
  wordCharCount.textContent = `${totalWords} word${totalWords !== 1 ? 's' : ''} • ${totalChars} character${totalChars !== 1 ? 's' : ''}`;
  updateCursorPositionForText(el);

  const start = el.selectionStart;
  const end = el.selectionEnd;
  
  if (start !== end && start !== undefined && end !== undefined) {
    const selectedText = text.substring(start, end);
    const selectedWords = selectedText.trim() ? selectedText.trim().split(/\s+/).filter(Boolean).length : 0;
    const selectedChars = selectedText.length;
    
    selectionCount.textContent = `${selectedWords} word${selectedWords !== 1 ? 's' : ''} • ${selectedChars} character${selectedChars !== 1 ? 's' : ''} selected`;
    selectionCount.style.display = "inline-block";
  } else {
    selectionCount.style.display = "none";
  }
}

function updateCursorPositionForText(el) {
  const position = getCursorPosition(
    el.value || "",
    el.selectionStart ?? 0,
    el.selectionEnd ?? el.selectionStart ?? 0,
    el.selectionDirection || "none"
  );

  cursorPosition.textContent = `Ln ${position.line}, Col ${position.column}`;
  cursorPosition.title = `Line ${position.line}, column ${position.column}`;
}

function moveNoteUp(noteId) {
  const targetId = noteId || activeNoteId;
  const index = notes.findIndex(n => n.id === targetId);
  if (!canMoveNote(notes, index, -1)) return;
  
  const [note] = notes.splice(index, 1);
  notes.splice(index - 1, 0, note);
  
  saveNotesToStorage({ syncWorkspace: true });
  renderNoteList(searchInput.value);
  populateSecondaryNoteSelect();
  showNotification("Note moved up");
}

function moveNoteDown(noteId) {
  const targetId = noteId || activeNoteId;
  const index = notes.findIndex(n => n.id === targetId);
  if (!canMoveNote(notes, index, 1)) return;
  
  const [note] = notes.splice(index, 1);
  notes.splice(index + 1, 0, note);
  
  saveNotesToStorage({ syncWorkspace: true });
  renderNoteList(searchInput.value);
  populateSecondaryNoteSelect();
  showNotification("Note moved down");
}

function toggleNotePinned(noteId) {
  const note = notes.find(candidate => candidate.id === noteId);
  if (!note) return;

  const willPin = !isNotePinned(note);
  notes = setNotePinned(notes, noteId, willPin);

  saveNotesToStorage({ syncWorkspace: true });
  renderNoteList(searchInput.value);
  populateSecondaryNoteSelect();
  showNotification(willPin ? "Note pinned to top" : "Note unpinned");
}

// ----------------------------------------------------
// Help & Reference Modal Logic
// ----------------------------------------------------
function openHelpModal(defaultTab = "shortcuts") {
  helpModalPreviousFocus = document.activeElement;
  isHelpModalOpen = true;
  helpModalBackdrop.style.display = "flex";
  helpModalBackdrop.setAttribute("aria-hidden", "false");
  helpBtn.setAttribute("aria-expanded", "true");
  switchHelpTab(defaultTab, true);
}

function closeHelpModal() {
  isHelpModalOpen = false;
  helpModalBackdrop.style.display = "none";
  helpModalBackdrop.setAttribute("aria-hidden", "true");
  helpBtn.setAttribute("aria-expanded", "false");
  if (helpModalPreviousFocus && helpModalPreviousFocus.isConnected) {
    helpModalPreviousFocus.focus({ preventScroll: true });
  }
  helpModalPreviousFocus = null;
}

function toggleHelpModal() {
  if (isHelpModalOpen) {
    closeHelpModal();
  } else {
    openHelpModal();
  }
}

function switchHelpTab(tabName, focusTab = false) {
  const isMarkdown = tabName === "markdown";

  tabMarkdownBtn.classList.toggle("active", isMarkdown);
  tabShortcutsBtn.classList.toggle("active", !isMarkdown);
  paneMarkdown.classList.toggle("active", isMarkdown);
  paneShortcuts.classList.toggle("active", !isMarkdown);

  tabMarkdownBtn.setAttribute("aria-selected", String(isMarkdown));
  tabShortcutsBtn.setAttribute("aria-selected", String(!isMarkdown));
  tabMarkdownBtn.tabIndex = isMarkdown ? 0 : -1;
  tabShortcutsBtn.tabIndex = isMarkdown ? -1 : 0;
  paneMarkdown.setAttribute("aria-hidden", String(!isMarkdown));
  paneShortcuts.setAttribute("aria-hidden", String(isMarkdown));

  if (focusTab) {
    (isMarkdown ? tabMarkdownBtn : tabShortcutsBtn).focus({ preventScroll: true });
  }
}

function cycleHelpTab(backwards = false) {
  const tabs = ["shortcuts", "markdown"];
  const currentTab = tabMarkdownBtn.classList.contains("active") ? "markdown" : "shortcuts";
  const currentIndex = tabs.indexOf(currentTab);
  const direction = backwards ? -1 : 1;
  const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
  switchHelpTab(tabs[nextIndex], true);
}

// ----------------------------------------------------
// About Modal Logic
// ----------------------------------------------------
function openAboutModal() {
  aboutModalPreviousFocus = document.activeElement;
  isAboutModalOpen = true;
  aboutModalBackdrop.style.display = "flex";
  aboutModalBackdrop.setAttribute("aria-hidden", "false");
  closeAboutBtn.focus({ preventScroll: true });
}

function closeAboutModal() {
  isAboutModalOpen = false;
  aboutModalBackdrop.style.display = "none";
  aboutModalBackdrop.setAttribute("aria-hidden", "true");
  if (aboutModalPreviousFocus && aboutModalPreviousFocus.isConnected) {
    aboutModalPreviousFocus.focus({ preventScroll: true });
  }
  aboutModalPreviousFocus = null;
}

function trapModalFocus(event, modal) {
  const focusable = [...modal.querySelectorAll(
    "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
  )];
  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if ((event.shiftKey && document.activeElement === first) ||
      (!event.shiftKey && document.activeElement === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

// ----------------------------------------------------
// Color Themes & Palette Engine
// ----------------------------------------------------
function openThemeModal() {
  themeModalPreviousFocus = actionsDropdown.contains(document.activeElement)
    ? actionsBtn
    : document.activeElement;
  isThemeModalOpen = true;
  themeModalBackdrop.style.display = "flex";
  themeModalBackdrop.setAttribute("aria-hidden", "false");
  themeToggleBtn.setAttribute("aria-expanded", "true");
  themePickerBtn.setAttribute("aria-expanded", "true");
  renderThemeGrid();
  closeThemeBtn.focus({ preventScroll: true });
}

function closeThemeModal() {
  isThemeModalOpen = false;
  themeModalBackdrop.style.display = "none";
  themeModalBackdrop.setAttribute("aria-hidden", "true");
  themeToggleBtn.setAttribute("aria-expanded", "false");
  themePickerBtn.setAttribute("aria-expanded", "false");
  if (themeModalPreviousFocus && themeModalPreviousFocus.isConnected) {
    themeModalPreviousFocus.focus({ preventScroll: true });
  }
  themeModalPreviousFocus = null;
}

function loadSavedThemes() {
  try {
    const saved = localStorage.getItem("scratchpad_custom_themes");
    if (saved) {
      const parsedThemes = JSON.parse(saved);
      if (Array.isArray(parsedThemes)) {
        customThemes = parsedThemes
          .map((theme, index) => normalizeCustomTheme(theme, index))
          .filter(Boolean);
        localStorage.setItem("scratchpad_custom_themes", JSON.stringify(customThemes));
      }
    }
  } catch (e) {}

  const storedThemeId = localStorage.getItem("scratchpad_active_theme");
  const savedThemeId = LEGACY_THEME_IDS[storedThemeId] || storedThemeId;
  const themeExists = [...PRESET_THEMES, ...customThemes]
    .some((theme) => theme.id === savedThemeId);

  if (savedThemeId && themeExists) {
    if (savedThemeId !== storedThemeId) {
      localStorage.setItem("scratchpad_active_theme", savedThemeId);
    }
    applyTheme(savedThemeId);
  } else {
    applyTheme("default-dark");
  }
}

function applyTheme(themeId) {
  activeThemeId = themeId;
  localStorage.setItem("scratchpad_active_theme", themeId);

  const root = document.documentElement;
  const themeBtnText = document.getElementById("theme-btn-text");

  if (themeId === "default-dark") {
    clearCustomThemeStyles();
    setTheme("dark");
    if (themeBtnText) themeBtnText.textContent = "Theme: Default Dark";
    renderThemeGrid();
    return;
  }
  if (themeId === "default-light") {
    clearCustomThemeStyles();
    setTheme("light");
    if (themeBtnText) themeBtnText.textContent = "Theme: Default Light";
    renderThemeGrid();
    return;
  }

  const allThemes = [...PRESET_THEMES, ...customThemes];
  const theme = allThemes.find(t => t.id === themeId);
  if (!theme) return;

  if (theme.uiStyle) {
    root.dataset.themeStyle = theme.uiStyle;
  } else {
    delete root.dataset.themeStyle;
  }

  const isDark = isColorDark(theme.background);
  if (isDark) {
    document.documentElement.classList.add("theme-dark");
    document.documentElement.classList.remove("theme-light");
  } else {
    document.documentElement.classList.add("theme-light");
    document.documentElement.classList.remove("theme-dark");
  }

  root.style.setProperty("--bg-app", theme.background);
  root.style.setProperty("--editor-bg", theme.background);
  root.style.setProperty("--editor-text", theme.foreground);
  root.style.setProperty("--preview-bg", theme.background);
  root.style.setProperty("--preview-text", theme.foreground);
  root.style.setProperty("--bg-sidebar", theme.sidebar || theme.background);
  root.style.setProperty("--sidebar-bg", theme.sidebar || theme.background);
  root.style.setProperty("--statusbar-bg", theme.sidebar || theme.background);
  root.style.setProperty("--topbar-bg", theme.sidebar || theme.background);
  root.style.setProperty("--dropdown-bg", theme.sidebar || theme.background);
  root.style.setProperty("--border-color", theme.border || "rgba(128,128,128,0.2)");
  root.style.setProperty("--text-primary", theme.foreground);
  root.style.setProperty("--accent-color", theme.accent || "#3b82f6");
  root.style.setProperty("--accent-hover", theme.accent || "#3b82f6");
  root.style.setProperty("--bg-note-active", theme.selection || "rgba(59,130,246,0.15)");
  root.style.setProperty("--border-note-active", theme.accent || "#3b82f6");

  if (themeBtnText) {
    themeBtnText.textContent = `Theme: ${theme.name}`;
  }
  activeThemeMenuValue.textContent = theme.name;

  renderThemeGrid();
}

function clearCustomThemeStyles() {
  const root = document.documentElement;
  const props = [
    "--bg-app", "--editor-bg", "--editor-text", "--preview-bg", "--preview-text",
    "--bg-sidebar", "--sidebar-bg", "--statusbar-bg", "--topbar-bg", "--dropdown-bg",
    "--border-color", "--text-primary", "--accent-color", "--accent-hover",
    "--bg-note-active", "--border-note-active"
  ];
  props.forEach(p => root.style.removeProperty(p));
  delete root.dataset.themeStyle;
}

function isColorDark(hex) {
  if (!hex || typeof hex !== "string" || !hex.startsWith("#")) return true;
  const c = hex.substring(1);
  const rgb = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16);
  if (isNaN(rgb)) return true;
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = (rgb >> 0) & 0xff;
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luma < 128;
}

function isValidColor(str) {
  if (!str || typeof str !== "string") return false;
  const s = str.trim();
  if (/["'<>;&\\\u0000-\u001f\u007f]/.test(s)) return false;
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s) ||
    (typeof CSS !== "undefined" && CSS.supports("color", s));
}

function normalizeCustomTheme(theme, index = 0) {
  if (!theme || typeof theme !== "object") return null;
  if (!isValidColor(theme.background) || !isValidColor(theme.foreground)) return null;

  return {
    id: typeof theme.id === "string" && theme.id ? theme.id : `custom_saved_${index}`,
    name: typeof theme.name === "string" && theme.name.trim() ? theme.name.trim() : `Custom Theme ${index + 1}`,
    background: theme.background.trim(),
    foreground: theme.foreground.trim(),
    sidebar: isValidColor(theme.sidebar) ? theme.sidebar.trim() : theme.background.trim(),
    accent: isValidColor(theme.accent) ? theme.accent.trim() : "#3b82f6",
    border: isValidColor(theme.border) ? theme.border.trim() : "rgba(128,128,128,0.2)",
    selection: isValidColor(theme.selection) ? theme.selection.trim() : "rgba(59,130,246,0.2)",
    isCustom: true
  };
}

async function promptImportError(title, message) {
  if (window.__TAURI__) {
    try {
      await invoke("show_alert_dialog", { title, message });
      return;
    } catch (e) {}
  }
  alert(`${title}\n\n${message}`);
}

function renderThemeGrid() {
  if (!themeGrid) return;
  themeGrid.innerHTML = "";

  const allThemes = [...PRESET_THEMES, ...customThemes];

  allThemes.forEach(theme => {
    const card = document.createElement("div");
    card.className = `theme-card ${theme.id === activeThemeId ? "active" : ""}`;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Use ${theme.name} theme`);
    card.setAttribute("aria-pressed", String(theme.id === activeThemeId));
    
    card.innerHTML = `
      <div class="theme-card-header">
        <span class="theme-card-name">${escapeHTML(theme.name)}</span>
        ${theme.id === activeThemeId ? '<span class="theme-card-badge">Active</span>' : ''}
      </div>
      <div class="theme-card-preview" style="background-color: ${theme.background};">
        <div class="theme-preview-sidebar" style="background-color: ${theme.sidebar || theme.background}; border-right: 1px solid ${theme.border || 'rgba(128,128,128,0.2)'};">
          <div class="theme-preview-line" style="background-color: ${theme.accent}; width: 60%;"></div>
          <div class="theme-preview-line" style="background-color: ${theme.foreground}; opacity: 0.5;"></div>
          <div class="theme-preview-line" style="background-color: ${theme.foreground}; opacity: 0.3;"></div>
        </div>
        <div class="theme-preview-editor" style="background-color: ${theme.background};">
          <div class="theme-preview-accent" style="background-color: ${theme.accent};"></div>
          <div class="theme-preview-line" style="background-color: ${theme.foreground}; opacity: 0.8; width: 90%;"></div>
          <div class="theme-preview-line" style="background-color: ${theme.foreground}; opacity: 0.5; width: 70%;"></div>
        </div>
      </div>
      ${theme.isCustom ? `
        <button class="theme-card-delete" title="Delete custom theme" aria-label="Delete ${escapeHTML(theme.name)} theme">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      ` : ''}
    `;

    card.addEventListener("click", () => {
      applyTheme(theme.id);
    });

    card.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && !event.target.closest(".theme-card-delete")) {
        event.preventDefault();
        applyTheme(theme.id);
      }
    });

    if (theme.isCustom) {
      const delBtn = card.querySelector(".theme-card-delete");
      if (delBtn) {
        delBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          deleteCustomTheme(theme.id);
        });
      }
    }

    themeGrid.appendChild(card);
  });
}

function deleteCustomTheme(themeId) {
  customThemes = customThemes.filter(t => t.id !== themeId);
  localStorage.setItem("scratchpad_custom_themes", JSON.stringify(customThemes));
  if (activeThemeId === themeId) {
    applyTheme("default-dark");
  } else {
    renderThemeGrid();
  }
}

async function importThemeFile() {
  try {
    let fileContent = "";
    let fileName = "";

    if (window.__TAURI__) {
      const selected = await invoke("import_file_native");
      if (!selected || !selected.content) return;
      fileContent = selected.content;
      fileName = selected.title || "imported_theme.json";
    } else {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,.toml,.yaml,.yml,.conf,.txt";
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        fileName = file.name;
        fileContent = await file.text();
        await processImportedTheme(fileContent, fileName);
      };
      input.click();
      return;
    }

    await processImportedTheme(fileContent, fileName);
  } catch (err) {
    console.error("Theme import failed:", err);
    await promptImportError("Theme Import Error", `Failed to read theme file: ${err}`);
  }
}

async function processImportedTheme(content, fileName) {
  if (!content || !content.trim()) {
    await promptImportError(
      "Theme Import Error",
      `The file "${fileName}" is empty.`
    );
    return;
  }

  const result = parseThemeContent(content, fileName);
  if (!result.success) {
    await promptImportError(
      "Invalid Theme File",
      `Could not import "${fileName}".\n\nReason: ${result.error}\n\nPlease ensure your file is a valid JSON or TOML color scheme with valid HEX or RGB color codes for "background" and "foreground".`
    );
    return;
  }

  const theme = result.theme;
  const existingIdx = customThemes.findIndex(t => t.id === theme.id || t.name.toLowerCase() === theme.name.toLowerCase());
  if (existingIdx !== -1) {
    customThemes[existingIdx] = theme;
  } else {
    customThemes.push(theme);
  }

  localStorage.setItem("scratchpad_custom_themes", JSON.stringify(customThemes));
  applyTheme(theme.id);
}

function parseThemeContent(content, fileName) {
  const cleanName = fileName.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");

  // 1. Try JSON
  try {
    const data = JSON.parse(content);
    if (typeof data !== "object" || data === null) {
      return { success: false, error: "Root JSON is not an object" };
    }

    const colors = data.colors || data;
    const bg = colors.background || colors["editor.background"] || colors.bg || colors.editor_bg;
    const fg = colors.foreground || colors["editor.foreground"] || colors.fg || colors.editor_text;

    if (!bg || !fg) {
      return { success: false, error: "Missing required 'background' or 'foreground' color properties" };
    }
    if (!isValidColor(bg)) {
      return { success: false, error: `Invalid background color value: "${bg}"` };
    }
    if (!isValidColor(fg)) {
      return { success: false, error: `Invalid foreground color value: "${fg}"` };
    }

    const sb = colors.sidebar || colors["sideBar.background"] || colors.sidebar_bg || colors["activityBar.background"] || bg;
    const accent = colors.accent || colors.cursor || colors["activityBar.foreground"] || colors["editorCursor.foreground"] || "#3b82f6";
    const border = colors.border || colors["panel.border"] || colors["sideBar.border"] || "rgba(128,128,128,0.2)";
    const sel = colors.selection || colors["editor.selectionBackground"] || colors["list.activeSelectionBackground"] || "rgba(59,130,246,0.2)";

    return {
      success: true,
      theme: {
        id: "custom_" + Date.now(),
        name: data.name || cleanName,
        background: bg,
        foreground: fg,
        sidebar: isValidColor(sb) ? sb : bg,
        accent: isValidColor(accent) ? accent : "#3b82f6",
        border: isValidColor(border) ? border : "rgba(128,128,128,0.2)",
        selection: isValidColor(sel) ? sel : "rgba(59,130,246,0.2)",
        isCustom: true
      }
    };
  } catch (e) {
    // If not valid JSON, proceed to TOML / Key-Value check
  }

  // 2. Try TOML / Key-Value / Alacritty / Ghostty style
  const lines = content.split("\n");
  const kv = {};
  for (const line of lines) {
    const clean = line.trim();
    if (!clean || clean.startsWith("#")) continue;
    const match = clean.match(/^([a-zA-Z0-9_.-]+)\s*[:=]\s*["']?([^"'\r\n#]+)["']?/);
    if (match) {
      kv[match[1].toLowerCase()] = match[2].trim();
    }
  }

  const bg = kv.background || kv.bg || kv.editor_bg;
  const fg = kv.foreground || kv.fg || kv.editor_text;

  if (bg && fg) {
    if (!isValidColor(bg)) {
      return { success: false, error: `Invalid background color value: "${bg}"` };
    }
    if (!isValidColor(fg)) {
      return { success: false, error: `Invalid foreground color value: "${fg}"` };
    }

    const sb = kv.sidebar || kv.sidebar_bg || bg;
    const accent = kv.accent || kv.cursor || "#3b82f6";
    const border = kv.border || "rgba(128,128,128,0.2)";
    const sel = kv.selection || "rgba(59,130,246,0.2)";

    return {
      success: true,
      theme: {
        id: "custom_" + Date.now(),
        name: kv.name || cleanName,
        background: bg,
        foreground: fg,
        sidebar: isValidColor(sb) ? sb : bg,
        accent: isValidColor(accent) ? accent : "#3b82f6",
        border: isValidColor(border) ? border : "rgba(128,128,128,0.2)",
        selection: isValidColor(sel) ? sel : "rgba(59,130,246,0.2)",
        isCustom: true
      }
    };
  }

  return { 
    success: false, 
    error: "File could not be parsed as valid JSON or TOML/Key-Value color scheme with valid 'background' and 'foreground' color codes" 
  };
}

function exportCurrentTheme() {
  const allThemes = [...PRESET_THEMES, ...customThemes];
  const active = allThemes.find(t => t.id === activeThemeId) || PRESET_THEMES[0];

  const exportData = {
    name: active.name,
    background: active.background,
    foreground: active.foreground,
    sidebar: active.sidebar,
    accent: active.accent,
    border: active.border,
    selection: active.selection
  };

  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${active.name.toLowerCase().replace(/\s+/g, "-")}-theme.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Boot up!
function startApp() {
  init().catch((error) => {
    console.error("Scratchpad failed to initialize", error);
    if (saveStatus) {
      saveStatus.textContent = "Startup error";
      saveStatus.title = String(error);
    }
  });
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", startApp, { once: true });
} else {
  startApp();
}
