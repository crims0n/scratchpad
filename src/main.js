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

const findBar = document.getElementById("find-bar");
const findInput = document.getElementById("find-input");
const findCount = document.getElementById("find-count");
const findPrevBtn = document.getElementById("find-prev");
const findNextBtn = document.getElementById("find-next");
const findCloseBtn = document.getElementById("find-close");

// State
let notes = [];
let activeNoteId = null;
let activeDbPath = null;
let currentLayoutMode = "edit"; // edit, split, preview
let isFocusMode = false;
let findMatches = [];
let activeMatchIndex = -1;
let isFindBarOpen = false;
let saveDebounceTimer = null;
let previewDebounceTimer = null;

// Initialize app
async function init() {
  // Check if an active SQLite database is configured
  const savedActiveDb = localStorage.getItem("scratchpad_active_db");
  if (savedActiveDb && window.__TAURI__) {
    activeDbPath = savedActiveDb;
    try {
      notes = await invoke("load_db_notes", { dbPath: activeDbPath });
      updateDbUiState(true);
    } catch (err) {
      console.error("Failed to load notes from SQLite DB on boot", err);
      showNotification("SQLite DB error: switched to local storage");
      activeDbPath = null;
      localStorage.removeItem("scratchpad_active_db");
      loadNotesFromLocalStorage();
      updateDbUiState(false);
    }
  } else {
    loadNotesFromLocalStorage();
    updateDbUiState(false);
  }

  // Create default note if none exist
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

  // Load layout mode and theme preference
  const savedLayoutMode = localStorage.getItem("scratchpad_layout_mode");
  if (savedLayoutMode) {
    setLayoutMode(savedLayoutMode);
  }

  // Load dark/light theme
  initTheme();

  // Render UI
  renderNoteList();
  loadActiveNote();

  // Attach event listeners
  attachEventListeners();
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
  markdownPreview.scrollTop = 0;
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
      activeNoteId = note.id;
      renderNoteList(searchInput.value);
      loadActiveNote();
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
  if (currentLayoutMode === "edit") return; // don't render if not visible

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
        showNotification("Import failed: " + err);
      });
  } else {
    // Safe web-based file reader fallback compatible across browser environments
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.txt,.markdown";
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (evt) => {
        const title = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
        createNote(title, evt.target.result);
        showNotification("Imported: " + title);
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

  // Find Widget events
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

  // Shortcuts
  document.addEventListener("keydown", (e) => {
    const isMeta = e.metaKey || e.ctrlKey;
    const isShift = e.shiftKey;

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

  // Sync scrolling of Edit & Preview in Split mode
  editorTextarea.addEventListener("scroll", () => {
    if (currentLayoutMode !== "split") return;
    
    const editScrollHeight = editorTextarea.scrollHeight - editorTextarea.clientHeight;
    if (editScrollHeight <= 0) return;
    
    const percentage = editorTextarea.scrollTop / editScrollHeight;
    const previewScrollHeight = markdownPreview.scrollHeight - markdownPreview.clientHeight;
    
    markdownPreview.scrollTop = percentage * previewScrollHeight;
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

// Find Widget functions
function toggleFindBar() {
  if (isFindBarOpen) {
    hideFindBar();
  } else {
    isFindBarOpen = true;
    findBar.style.display = "flex";
    
    // Check if there is selected text in the textarea, prefill the find input
    const selection = editorTextarea.value.substring(editorTextarea.selectionStart, editorTextarea.selectionEnd);
    if (selection) {
      findInput.value = selection;
    }
    
    findInput.focus();
    findInput.select();
    runFind();
  }
}

function hideFindBar() {
  isFindBarOpen = false;
  findBar.style.display = "none";
  findMatches = [];
  activeMatchIndex = -1;
  findInput.value = "";
  updateFindCount();
  editorTextarea.focus();
}

function runFind() {
  const query = findInput.value;
  findMatches = [];
  activeMatchIndex = -1;
  
  if (!query) {
    updateFindCount();
    return;
  }
  
  const text = editorTextarea.value;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let index = 0;
  
  while ((index = lowerText.indexOf(lowerQuery, index)) !== -1) {
    findMatches.push({
      start: index,
      end: index + query.length
    });
    index += query.length;
  }
  
  if (findMatches.length > 0) {
    activeMatchIndex = 0;
    selectMatch(0);
  } else {
    updateFindCount();
  }
}

function selectMatch(index) {
  if (index < 0 || index >= findMatches.length) return;
  activeMatchIndex = index;
  const match = findMatches[index];
  
  editorTextarea.focus();
  editorTextarea.setSelectionRange(match.start, match.end);
  
  // Custom scroll calculation to scroll selected match into view
  const textBefore = editorTextarea.value.substring(0, match.start);
  const lineCountBefore = textBefore.split("\n").length;
  const lineHeight = parseFloat(window.getComputedStyle(editorTextarea).lineHeight) || 20;
  
  editorTextarea.scrollTop = (lineCountBefore - 3) * lineHeight;
  
  updateFindCount();
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

function updateFindCount() {
  if (findMatches.length === 0) {
    findCount.textContent = "0 of 0";
  } else {
    findCount.textContent = `${activeMatchIndex + 1} of ${findMatches.length}`;
  }
}

// Boot up!
window.addEventListener("DOMContentLoaded", init);
