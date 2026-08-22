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
const editorTextarea = document.getElementById("editor-textarea");
const markdownPreview = document.getElementById("markdown-preview");
const wordCharCount = document.getElementById("word-char-count");
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
const dbDivider = document.getElementById("db-divider");

const panesContainer = document.getElementById("panes-container");
const primaryPaneWrapper = document.getElementById("primary-pane-wrapper");
const secondaryPaneWrapper = document.getElementById("secondary-pane-wrapper");
const secondaryNoteSelect = document.getElementById("secondary-note-select");
const secondaryNoteTitle = document.getElementById("secondary-note-title");
const closeSecondaryBtn = document.getElementById("close-secondary-btn");
const secondaryEditorPane = document.getElementById("secondary-editor-pane");
const secondaryEditorWrapper = document.getElementById("secondary-editor-wrapper");
const secondaryEditorTextarea = document.getElementById("secondary-editor-textarea");
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
const findRegexToggleBtn = document.getElementById("find-regex-toggle");
const replaceRow = document.getElementById("replace-row");
const replaceInput = document.getElementById("replace-input");
const replaceOneBtn = document.getElementById("replace-one-btn");
const replaceAllBtn = document.getElementById("replace-all-btn");
const editorBackdrop = document.getElementById("editor-backdrop");

const customContextMenu = document.getElementById("custom-context-menu");
const ctxCutBtn = document.getElementById("ctx-cut");
const ctxCopyBtn = document.getElementById("ctx-copy");
const ctxPasteBtn = document.getElementById("ctx-paste");
const ctxSelectAllBtn = document.getElementById("ctx-select-all");
const ctxFindBtn = document.getElementById("ctx-find");
const ctxOpenSideBtn = document.getElementById("ctx-open-side");
const ctxSidebarDivider = document.getElementById("ctx-sidebar-divider");
const ctxMoveUpBtn = document.getElementById("ctx-move-up");
const ctxMoveDownBtn = document.getElementById("ctx-move-down");

// State
let notes = [];
let activeNoteId = null;
let secondaryNoteId = null;
let activePane = "primary"; // "primary" or "secondary"
let isSplitNoteMode = false;
let draggedNoteId = null;
let activeDbPath = null;
let currentLayoutMode = "edit"; // edit, split, preview
let isFocusMode = false;
let findMatches = [];
let activeMatchIndex = -1;
let isFindBarOpen = false;
let contextMenuTarget = null;
let contextMenuNoteId = null;
let isRegexMode = false;
let isReplaceOpen = false;
let saveDebounceTimer = null;
let previewDebounceTimer = null;

// Initialize app
async function init() {
  // 1. Attach all event listeners immediately so all UI buttons and keyboard shortcuts are live
  attachEventListeners();

  // 2. Load dark/light theme & layout mode
  initTheme();
  const savedLayoutMode = localStorage.getItem("scratchpad_layout_mode");
  if (savedLayoutMode) {
    setLayoutMode(savedLayoutMode);
  }

  // 3. Always load existing LocalStorage notes first as guaranteed baseline
  loadNotesFromLocalStorage();

  // 4. Check if an active SQLite database is configured
  const savedActiveDb = localStorage.getItem("scratchpad_active_db");
  if (savedActiveDb && window.__TAURI__) {
    activeDbPath = savedActiveDb;
    try {
      const dbNotes = await invoke("load_db_notes", { dbPath: activeDbPath });
      if (Array.isArray(dbNotes) && dbNotes.length > 0) {
        notes = dbNotes;
      } else if (notes.length > 0) {
        // Seed empty SQLite database with existing LocalStorage notes
        notes.forEach(note => {
          invoke("save_note_db", { dbPath: activeDbPath, note: note })
            .catch(err => console.error("Failed to seed note to SQLite DB", err));
        });
      }
      updateDbUiState(true);
    } catch (err) {
      console.error("Failed to load notes from SQLite DB on boot", err);
      showNotification("SQLite DB error: switched to local storage");
      activeDbPath = null;
      localStorage.removeItem("scratchpad_active_db");
      updateDbUiState(false);
    }
  } else {
    updateDbUiState(false);
  }

  // 5. Create default note if none exist
  if (notes.length === 0) {
    createNote("Welcome to Scratchpad!", `# Welcome to Scratchpad!

This is a fast, offline-first markdown scratchpad.

## Features
- **Auto-save**: Every stroke is stored instantly.
- **Markdown Preview**: Click **Split** or **Preview** above to toggle the live rendering.
- **Multiple Notes**: Manage your ideas in the sidebar.
- **Focus Mode**: Press \`Cmd+Shift+F\` or click the focus button for distraction-free writing.

## Basic Markdown Guide
Here is a quick cheat sheet:

### Text formatting
You can make text **bold** using double asterisks or *italic* using single asterisks. 

### Blockquotes
> Focus is a matter of deciding what things you're not going to do.
> — *Steve Jobs*

### Code blocks
Inline \`code\` is simple, and block code uses triple backticks:
\`\`\`javascript
function greet() {
  console.log("Hello, scratchpad!");
}
\`\`\`

### Lists
1. First item
2. Second item
   - Sub item A
   - Sub item B
`);
  } else {
    // Select first note by default
    activeNoteId = notes[0].id;
  }

  // 6. Render UI
  renderNoteList();
  loadActiveNote();
}

// ----------------------------------------------------
// Theme Handling (respecting modern-web-guidance)
// ----------------------------------------------------
function initTheme() {
  const savedTheme = localStorage.getItem("color-scheme");
  const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)");

  if (savedTheme) {
    setTheme(savedTheme);
  } else {
    // Default to system preference
    const currentSystemTheme = systemPrefersDark.matches ? "dark" : "light";
    setTheme(currentSystemTheme, false); // don't pin it in localStorage yet
  }

  // React to OS system-level theme shifts
  systemPrefersDark.addEventListener("change", (e) => {
    if (!localStorage.getItem("color-scheme")) {
      setTheme(e.matches ? "dark" : "light", false);
    }
  });
}

function setTheme(theme, pin = true) {
  const isDark = theme === "dark";
  
  if (isDark) {
    document.documentElement.classList.add("theme-dark");
    document.documentElement.classList.remove("theme-light");
    themeToggleBtn.querySelector(".light-icon").style.display = "none";
    themeToggleBtn.querySelector(".dark-icon").style.display = "block";
    themeToggleBtn.querySelector(".btn-text").textContent = "Dark Mode";
  } else {
    document.documentElement.classList.add("theme-light");
    document.documentElement.classList.remove("theme-dark");
    themeToggleBtn.querySelector(".light-icon").style.display = "block";
    themeToggleBtn.querySelector(".dark-icon").style.display = "none";
    themeToggleBtn.querySelector(".btn-text").textContent = "Light Mode";
  }

  if (pin) {
    localStorage.setItem("color-scheme", theme);
  } else {
    localStorage.removeItem("color-scheme");
  }
}

function toggleTheme() {
  const isCurrentlyDark = document.documentElement.classList.contains("theme-dark") || 
    (!document.documentElement.classList.contains("theme-light") && window.matchMedia("(prefers-color-scheme: dark)").matches);
  
  setTheme(isCurrentlyDark ? "light" : "dark");
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
    isTitleLocked: title !== "Untitled Scratchpad" && title !== "Welcome to Scratchpad!"
  };
  
  notes.unshift(newNote);
  activeNoteId = newNote.id;
  
  saveNotesToStorage();
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
  
  // If database is active, delete it there
  if (activeDbPath) {
    invoke("delete_note_db", { dbPath: activeDbPath, id: id })
      .catch(err => console.error("Failed to delete note from SQLite DB", err));
  }
  
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
  
  saveNotesToStorage();
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
  markdownPreview.scrollTop = 0;
  updateHighlights();
}

function renderNoteList(filter = "") {
  noteList.innerHTML = "";
  
  const filteredNotes = notes.filter(note => {
    const query = filter.toLowerCase();
    return note.title.toLowerCase().includes(query) || note.content.toLowerCase().includes(query);
  });
  
  filteredNotes.forEach(note => {
    const item = document.createElement("li");
    item.className = `note-item ${note.id === activeNoteId ? "active" : ""}`;
    item.setAttribute("data-id", note.id);
    item.setAttribute("draggable", "true");
    
    // Snippet formatting
    const firstLine = note.content.trim().split("\n")[0] || "";
    const snippet = firstLine.replace(/[#*`>_\-]/g, "").trim() || "Empty scratchpad...";
    
    const formattedDate = new Date(note.updatedAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });

    item.innerHTML = `
      <div class="note-item-header">
        <span class="note-item-title">${escapeHTML(note.title)}</span>
        <button class="note-item-delete" title="Delete scratchpad">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
      <div class="note-item-snippet">${escapeHTML(snippet)}</div>
      <div class="note-item-meta">
        <span>${formattedDate}</span>
      </div>
    `;
    
    // Switch to selected note on click
    item.addEventListener("click", () => {
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

    // Right click for context menu (Open to the side, move up/down)
    item.addEventListener("contextmenu", (e) => {
      e.stopPropagation();
      contextMenuNoteId = note.id;
      showContextMenu(e, note.id);
    });

    // Drag and Drop reordering events
    item.addEventListener("dragstart", (e) => {
      draggedNoteId = note.id;
      item.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", note.id);
    });

    item.addEventListener("dragend", () => {
      draggedNoteId = null;
      item.classList.remove("dragging");
      document.querySelectorAll(".note-item").forEach(el => {
        el.classList.remove("drag-over-top", "drag-over-bottom");
      });
    });

    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (!draggedNoteId || draggedNoteId === note.id) return;
      
      const rect = item.getBoundingClientRect();
      const offset = e.clientY - rect.top;
      const isTop = offset < rect.height / 2;
      
      item.classList.toggle("drag-over-top", isTop);
      item.classList.toggle("drag-over-bottom", !isTop);
    });

    item.addEventListener("dragleave", (e) => {
      if (e.relatedTarget && item.contains(e.relatedTarget)) return;
      item.classList.remove("drag-over-top", "drag-over-bottom");
    });

    item.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      item.classList.remove("drag-over-top", "drag-over-bottom");
      
      const sourceId = draggedNoteId || e.dataTransfer.getData("text/plain");
      if (!sourceId || sourceId === note.id) return;
      
      const fromIndex = notes.findIndex(n => n.id === sourceId);
      const toIndex = notes.findIndex(n => n.id === note.id);
      if (fromIndex === -1 || toIndex === -1) return;
      
      const rect = item.getBoundingClientRect();
      const isTop = (e.clientY - rect.top) < (rect.height / 2);
      
      // Remove dragged note from list
      const [draggedNote] = notes.splice(fromIndex, 1);
      
      // Re-find target note's current index after splice
      let targetIndex = notes.findIndex(n => n.id === note.id);
      if (!isTop) {
        targetIndex += 1;
      }
      
      notes.splice(targetIndex, 0, draggedNote);
      
      saveNotesToStorage();
      renderNoteList(searchInput.value);
      populateSecondaryNoteSelect();
      showNotification("Notes reordered");
    });
    
    // Delete listener
    item.querySelector(".note-item-delete").addEventListener("click", (e) => {
      deleteNote(note.id, e);
    });

    noteList.appendChild(item);
  });
}

function saveNotesToStorage() {
  localStorage.setItem("scratchpad_notes", JSON.stringify(notes));
  
  if (activeDbPath && activeNoteId) {
    const activeNote = notes.find(n => n.id === activeNoteId);
    if (activeNote) {
      invoke("save_note_db", { dbPath: activeDbPath, note: activeNote })
        .catch(err => {
          console.error("Failed to save note to SQLite DB", err);
          showNotification("SQLite DB save failed!");
        });
    }
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
  updateHighlights();

  // Premium feature: auto-rename title from first line of text
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
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    saveNotesToStorage();
    renderNoteList(searchInput.value);
    setSavedState();
  }, 400);

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

  triggerSavingState();
  
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    saveNotesToStorage();
    renderNoteList(searchInput.value);
    setSavedState();
  }, 400);
}

function triggerSavingState() {
  saveStatus.textContent = "Saving...";
  saveStatus.classList.add("unsaved");
}

function setSavedState() {
  if (activeDbPath) {
    const fileName = activeDbPath.split(/[/\\]/).pop();
    saveStatus.textContent = `Saved (SQLite: ${fileName})`;
  } else {
    saveStatus.textContent = "Saved";
  }
  saveStatus.classList.remove("unsaved");
}

function updateWordCharCount() {
  const text = editorTextarea.value;
  const totalWords = text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
  const totalChars = text.length;
  
  // Always update global count on the left
  wordCharCount.textContent = `${totalWords} word${totalWords !== 1 ? 's' : ''} • ${totalChars} character${totalChars !== 1 ? 's' : ''}`;

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
  
  // Debug log to console
  console.log("window.marked state:", typeof window.marked, window.marked);
  
  if (window.marked) {
    try {
      let html = "";
      if (typeof window.marked.parse === "function") {
        html = window.marked.parse(rawText || "*Empty scratchpad*");
      } else if (typeof window.marked === "function") {
        html = window.marked(rawText || "*Empty scratchpad*");
      } else {
        throw new Error("window.marked is neither a function nor contains a parse function");
      }
      markdownPreview.innerHTML = html;
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
}

function toggleSidebar() {
  sidebar.classList.toggle("collapsed");
}

function toggleFocusMode() {
  isFocusMode = !isFocusMode;
  if (isFocusMode) {
    appContainer.classList.add("focus-mode");
    sidebar.classList.add("collapsed");
  } else {
    appContainer.classList.remove("focus-mode");
    sidebar.classList.remove("collapsed");
  }
}

// ----------------------------------------------------
// Actions: Export, Copy, Share
// ----------------------------------------------------
function toggleActionsDropdown(show) {
  if (show === undefined) {
    actionsDropdown.classList.toggle("show");
  } else if (show) {
    actionsDropdown.classList.add("show");
  } else {
    actionsDropdown.classList.remove("show");
  }
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
    html = window.marked.parse(editorTextarea.value);
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
  const originalStatus = saveStatus.textContent;
  const originalClass = saveStatus.className;
  
  saveStatus.textContent = msg;
  saveStatus.className = ""; // clear unsaved indicator during alert
  
  setTimeout(() => {
    saveStatus.textContent = originalStatus;
    saveStatus.className = originalClass;
  }, 2000);
}

// ----------------------------------------------------
// Event Listeners
// ----------------------------------------------------
function attachEventListeners() {
  // Editor and Title inputs
  editorTextarea.addEventListener("input", handleEditorInput);
  editorTextarea.addEventListener("select", updateWordCharCount);
  editorTextarea.addEventListener("mouseup", updateWordCharCount);
  editorTextarea.addEventListener("keyup", updateWordCharCount);
  noteTitleInput.addEventListener("input", handleTitleInput);

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

  // Focus toggle
  focusBtn.addEventListener("click", toggleFocusMode);

  // Split Note toggle
  splitNoteBtn.addEventListener("click", () => toggleSplitNoteMode());
  closeSecondaryBtn.addEventListener("click", () => toggleSplitNoteMode(false));
  secondaryNoteSelect.addEventListener("change", (e) => {
    secondaryNoteId = e.target.value;
    loadSecondaryNote();
  });
  secondaryEditorTextarea.addEventListener("input", handleSecondaryEditorInput);
  secondaryEditorTextarea.addEventListener("select", () => updateWordCharCountForText(secondaryEditorTextarea));
  secondaryEditorTextarea.addEventListener("focus", () => setActivePane("secondary"));
  editorTextarea.addEventListener("focus", () => setActivePane("primary"));
  secondaryNoteTitle.addEventListener("input", handleSecondaryTitleInput);

  // Theme toggle
  themeToggleBtn.addEventListener("click", toggleTheme);

  // Actions menu
  actionsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleActionsDropdown();
  });

  document.addEventListener("click", () => {
    toggleActionsDropdown(false);
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

  ctxCutBtn.addEventListener("click", handleContextCut);
  ctxCopyBtn.addEventListener("click", handleContextCopy);
  ctxPasteBtn.addEventListener("click", handleContextPaste);
  ctxSelectAllBtn.addEventListener("click", handleContextSelectAll);
  ctxFindBtn.addEventListener("click", handleContextFind);
  ctxOpenSideBtn.addEventListener("click", () => {
    hideContextMenu();
    if (contextMenuNoteId) {
      openNoteInSecondaryPane(contextMenuNoteId);
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
  findToggleReplaceBtn.addEventListener("click", () => toggleReplace());
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
    if (isMeta && (e.key === "\\" || e.key === "|")) {
      e.preventDefault();
      toggleSplitNoteMode();
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
      if (isFindBarOpen) {
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

    if (currentLayoutMode !== "split") return;
    
    const editScrollHeight = editorTextarea.scrollHeight - editorTextarea.clientHeight;
    if (editScrollHeight <= 0) return;
    
    const percentage = editorTextarea.scrollTop / editScrollHeight;
    const previewScrollHeight = markdownPreview.scrollHeight - markdownPreview.clientHeight;
    
    markdownPreview.scrollTop = percentage * previewScrollHeight;
  });

  secondaryEditorTextarea.addEventListener("scroll", () => {
    secondaryEditorBackdrop.scrollTop = secondaryEditorTextarea.scrollTop;

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
  const savedNotes = localStorage.getItem("scratchpad_notes");
  if (savedNotes) {
    try {
      notes = JSON.parse(savedNotes);
    } catch (e) {
      console.error("Failed to parse saved notes, resetting", e);
      notes = [];
    }
  }
}

function updateDbUiState(isConnected) {
  if (isConnected && activeDbPath) {
    dbConnectBtn.style.display = "none";
    dbDisconnectBtn.style.display = "block";
    
    const fileName = activeDbPath.split(/[/\\]/).pop();
    saveStatus.textContent = `Saved (SQLite: ${fileName})`;
    saveStatus.title = `Database File: ${activeDbPath}`;
  } else {
    dbConnectBtn.style.display = "block";
    dbDisconnectBtn.style.display = "none";
    
    saveStatus.textContent = "Saved";
    saveStatus.title = "Saved to local webview storage";
  }
}

function connectDatabase() {
  if (!window.__TAURI__) {
    showNotification("SQLite is only available in Desktop App mode!");
    return;
  }
  
  invoke("select_db_file")
    .then((path) => {
      if (path) {
        activeDbPath = path;
        localStorage.setItem("scratchpad_active_db", path);
        
        // Load notes from the selected database
        invoke("load_db_notes", { dbPath: path })
          .then((dbNotes) => {
            notes = dbNotes;
            updateDbUiState(true);
            
            // If the database is completely empty, seed it with current LocalStorage notes
            if (notes.length === 0) {
              const savedNotes = localStorage.getItem("scratchpad_notes");
              if (savedNotes) {
                try {
                  const fallbackNotes = JSON.parse(savedNotes);
                  if (fallbackNotes.length > 0) {
                    notes = fallbackNotes;
                    notes.forEach((note) => {
                      invoke("save_note_db", { dbPath: path, note: note })
                        .catch(err => console.error("Failed to seed note to SQLite DB", err));
                    });
                  }
                } catch (e) {}
              }
            }
            
            if (notes.length === 0) {
              createNote();
            } else {
              activeNoteId = notes[0].id;
              renderNoteList();
              loadActiveNote();
            }
            
            showNotification("SQLite database connected!");
          })
          .catch((err) => {
            showNotification("Failed to read database: " + err);
            disconnectDatabase();
          });
      }
    })
    .catch((err) => {
      showNotification("Database selection failed: " + err);
    });
}

function disconnectDatabase() {
  activeDbPath = null;
  localStorage.removeItem("scratchpad_active_db");
  
  loadNotesFromLocalStorage();
  
  if (notes.length === 0) {
    createNote();
  } else {
    activeNoteId = notes[0].id;
    renderNoteList();
    loadActiveNote();
  }
  
  updateDbUiState(false);
  showNotification("Switched to LocalStorage");
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
  findBar.style.display = "none";
  findMatches = [];
  activeMatchIndex = -1;
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
  if (isReplaceOpen) {
    replaceInput.focus();
  }
}

function toggleRegexMode() {
  isRegexMode = !isRegexMode;
  findRegexToggleBtn.classList.toggle("active", isRegexMode);
  runFind();
}

function runFind() {
  const query = findInput.value;
  findMatches = [];
  activeMatchIndex = -1;
  findInput.classList.remove("invalid-regex");
  
  if (!query) {
    updateFindCount();
    updateHighlights();
    return;
  }
  
  const text = editorTextarea.value;
  
  if (isRegexMode) {
    try {
      const regex = new RegExp(query, "gi");
      let match;
      
      while ((match = regex.exec(text)) !== null) {
        if (match[0].length === 0) {
          regex.lastIndex++;
          continue;
        }
        findMatches.push({
          start: match.index,
          end: match.index + match[0].length,
          text: match[0]
        });
      }
    } catch (e) {
      findInput.classList.add("invalid-regex");
      updateFindCount("Invalid");
      updateHighlights();
      return;
    }
  } else {
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let index = 0;
    
    while ((index = lowerText.indexOf(lowerQuery, index)) !== -1) {
      findMatches.push({
        start: index,
        end: index + query.length,
        text: text.substring(index, index + query.length)
      });
      index += query.length;
    }
  }
  
  if (findMatches.length > 0) {
    activeMatchIndex = 0;
    selectMatch(0, false); // Do not steal focus from search input
  } else {
    updateFindCount();
    updateHighlights();
  }
}

function selectMatch(index, focusEditor = false) {
  if (index < 0 || index >= findMatches.length) return;
  activeMatchIndex = index;
  const match = findMatches[index];
  
  if (focusEditor) {
    editorTextarea.focus();
  }
  editorTextarea.setSelectionRange(match.start, match.end);
  
  // Custom scroll calculation to scroll selected match into view
  const textBefore = editorTextarea.value.substring(0, match.start);
  const lineCountBefore = textBefore.split("\n").length;
  const lineHeight = parseFloat(window.getComputedStyle(editorTextarea).lineHeight) || 20;
  
  editorTextarea.scrollTop = (lineCountBefore - 3) * lineHeight;
  editorBackdrop.scrollTop = editorTextarea.scrollTop; // sync scroll immediately
  
  updateFindCount();
  updateHighlights();
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
      const regex = new RegExp(findInput.value, "i");
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
  
  let newContent = "";
  if (isRegexMode) {
    try {
      const regex = new RegExp(query, "gi");
      newContent = text.replace(regex, replaceText);
    } catch (e) {
      return;
    }
  } else {
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedQuery, "gi");
    newContent = text.replace(regex, replaceText);
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

function updateHighlights() {
  const text = editorTextarea.value;
  const query = findInput.value;
  
  if (!isFindBarOpen || !query || findMatches.length === 0) {
    editorBackdrop.innerHTML = escapeHTML(text) + "\n";
    return;
  }
  
  let html = "";
  let lastIndex = 0;
  
  for (let i = 0; i < findMatches.length; i++) {
    const match = findMatches[i];
    if (match.start < lastIndex) continue;
    
    const before = text.substring(lastIndex, match.start);
    const matchText = text.substring(match.start, match.end);
    
    const isActive = (i === activeMatchIndex);
    const markClass = isActive ? 'class="active-match"' : '';
    
    html += escapeHTML(before) + `<mark ${markClass}>` + escapeHTML(matchText) + "</mark>";
    lastIndex = match.end;
  }
  html += escapeHTML(text.substring(lastIndex));
  
  if (html.endsWith("\n")) {
    html += "\n";
  }
  
  editorBackdrop.innerHTML = html;
}

// ----------------------------------------------------
// Custom Context Menu Logic
// ----------------------------------------------------
function showContextMenu(e, noteId = null) {
  e.preventDefault();
  
  if (noteId) {
    contextMenuNoteId = noteId;
    ctxOpenSideBtn.style.display = "flex";
    ctxSidebarDivider.style.display = "block";
    ctxMoveUpBtn.style.display = "flex";
    ctxMoveDownBtn.style.display = "flex";
    
    const noteIndex = notes.findIndex(n => n.id === noteId);
    ctxMoveUpBtn.disabled = noteIndex <= 0;
    ctxMoveDownBtn.disabled = noteIndex === -1 || noteIndex >= notes.length - 1;
    
    ctxCutBtn.style.display = "none";
    ctxCopyBtn.style.display = "none";
    ctxPasteBtn.style.display = "none";
    ctxSelectAllBtn.style.display = "none";
    ctxFindBtn.style.display = "none";
  } else {
    contextMenuNoteId = null;
    ctxOpenSideBtn.style.display = "none";
    ctxSidebarDivider.style.display = "none";
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
  const menuHeight = 180;
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
  customContextMenu.style.display = "flex";
}

function hideContextMenu() {
  customContextMenu.style.display = "none";
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
  isSplitNoteMode = typeof forceState === "boolean" ? forceState : !isSplitNoteMode;
  
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
    appContainer.classList.remove("dual-note-active");
    panesContainer.classList.remove("dual-split-mode");
    secondaryPaneWrapper.style.display = "none";
    splitNoteBtn.classList.remove("active");
    activePane = "primary";
    editorTextarea.focus();
  }
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

  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    saveNotesToStorage();
    renderNoteList(searchInput.value);
    setSavedState();
  }, 400);

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

  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    saveNotesToStorage();
    renderNoteList(searchInput.value);
    populateSecondaryNoteSelect();
    setSavedState();
  }, 400);
}

function updateSecondaryMarkdownPreview() {
  if (currentLayoutMode === "edit") return;
  if (window.marked) {
    secondaryMarkdownPreview.innerHTML = window.marked.parse(secondaryEditorTextarea.value);
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

function moveNoteUp(noteId) {
  const targetId = noteId || activeNoteId;
  const index = notes.findIndex(n => n.id === targetId);
  if (index <= 0) return;
  
  const [note] = notes.splice(index, 1);
  notes.splice(index - 1, 0, note);
  
  saveNotesToStorage();
  renderNoteList(searchInput.value);
  populateSecondaryNoteSelect();
  showNotification("Note moved up");
}

function moveNoteDown(noteId) {
  const targetId = noteId || activeNoteId;
  const index = notes.findIndex(n => n.id === targetId);
  if (index === -1 || index >= notes.length - 1) return;
  
  const [note] = notes.splice(index, 1);
  notes.splice(index + 1, 0, note);
  
  saveNotesToStorage();
  renderNoteList(searchInput.value);
  populateSecondaryNoteSelect();
  showNotification("Note moved down");
}

// Boot up!
window.addEventListener("DOMContentLoaded", init);
