// SPDX-License-Identifier: GPL-3.0-or-later

export function createTrashUi(adapter) {
  const button = document.getElementById("trash-btn");
  const menu = document.getElementById("trash-context-menu");
  const menuEmpty = document.getElementById("trash-menu-empty");
  const backdrop = document.getElementById("trash-modal-backdrop");
  const modal = document.getElementById("trash-modal");
  const closeButton = document.getElementById("close-trash-btn");
  const list = document.getElementById("trash-list");
  const status = document.getElementById("trash-status");
  const confirmation = document.getElementById("trash-empty-confirmation");
  const confirmButton = document.getElementById("confirm-empty-trash-btn");
  const cancelButton = document.getElementById("cancel-empty-trash-btn");
  let open = false;
  let busy = false;
  let pendingEmpty = null;
  let previousFocus = null;

  function close() {
    menu.style.display = "none";
    if (!open) return;
    open = false;
    pendingEmpty = null;
    backdrop.style.display = "none";
    backdrop.setAttribute("aria-hidden", "true");
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }

  function refresh() {
    const { entries, error } = adapter.state();
    button.title = `Trash (${entries.length}) — click to restore, right-click to empty`;
    button.setAttribute("aria-label", error ? "Trash unavailable" : `Trash, ${entries.length} deleted notes`);
    button.classList.toggle("has-trash", entries.length > 0);
    menuEmpty.disabled = entries.length === 0 || Boolean(error) || busy;
    if (!open) return;
    confirmation.hidden = !pendingEmpty;
    list.hidden = Boolean(pendingEmpty);
    confirmButton.disabled = busy;
    cancelButton.disabled = busy;
    list.replaceChildren();
    if (error) { status.textContent = error; return; }
    status.textContent = pendingEmpty ? `This permanently deletes ${pendingEmpty.ids.length} deleted note${pendingEmpty.ids.length === 1 ? "" : "s"}. This cannot be undone.`
      : entries.length ? "Deleted notes stay here until you empty the trash." : "Trash is empty.";
    for (const entry of [...entries].reverse()) {
      const row = document.createElement("li");
      const details = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = entry.note.title || "Untitled Scratchpad";
      const metadata = document.createElement("span");
      metadata.textContent = `${entry.folderName || "Top level"} · ${new Date(entry.deletedAt).toLocaleString()}`;
      details.append(title, metadata);
      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "mcp-config-copy-btn";
      restore.textContent = "Restore";
      restore.setAttribute("aria-label", `Restore ${entry.note.title || "Untitled Scratchpad"}`);
      restore.dataset.trashId = entry.id;
      restore.disabled = busy;
      restore.addEventListener("click", () => run(() => adapter.restore(entry.id, adapter.state().collectionId)));
      row.append(details, restore);
      list.append(row);
    }
  }

  async function run(operation) {
    if (busy) return;
    busy = true;
    refresh();
    try {
      await operation();
      pendingEmpty = null;
      refresh();
      if (open) closeButton.focus({ preventScroll: true });
    } catch (error) {
      status.textContent = `Could not complete trash action: ${error.message || error}`;
    } finally {
      busy = false;
      confirmButton.disabled = false;
      cancelButton.disabled = false;
      list.querySelectorAll("button").forEach(button => { button.disabled = false; });
    }
  }

  function show(empty = false) {
    menu.style.display = "none";
    previousFocus = button;
    const { entries, collectionId, error } = adapter.state();
    pendingEmpty = empty && entries.length && !error ? { ids: entries.map(entry => entry.id), collectionId } : null;
    open = true;
    backdrop.style.display = "flex";
    backdrop.setAttribute("aria-hidden", "false");
    refresh();
    (pendingEmpty ? cancelButton : closeButton).focus({ preventScroll: true });
  }

  function showMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    refresh();
    const rect = button.getBoundingClientRect();
    const x = event.clientX || rect.left;
    const y = event.clientY || rect.top;
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - 188))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - 56))}px`;
    menu.style.display = "flex";
    menuEmpty.focus({ preventScroll: true });
  }

  button.addEventListener("click", () => show());
  button.addEventListener("contextmenu", showMenu);
  button.addEventListener("keydown", event => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) showMenu(event);
  });
  menuEmpty.addEventListener("click", () => show(true));
  document.addEventListener("click", () => { menu.style.display = "none"; });
  window.addEventListener("blur", () => { menu.style.display = "none"; });
  closeButton.addEventListener("click", close);
  backdrop.addEventListener("click", event => { if (event.target === backdrop) close(); });
  cancelButton.addEventListener("click", () => { pendingEmpty = null; refresh(); closeButton.focus(); });
  confirmButton.addEventListener("click", () => {
    if (!pendingEmpty) return;
    const { ids, collectionId } = pendingEmpty;
    run(() => adapter.empty(ids, collectionId));
  });
  document.addEventListener("keydown", event => {
    if (!open) {
      if (event.key === "Escape" && menu.style.display !== "none") { menu.style.display = "none"; button.focus(); }
      return;
    }
    // Keep global editing shortcuts out of the trash dialog.
    event.stopImmediatePropagation();
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key === "Tab") {
      const focusable = [...modal.querySelectorAll("button:not([disabled])")]
        .filter(element => !element.closest("[hidden]"));
      const first = focusable[0]; const last = focusable.at(-1);
      if (!modal.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }, true);
  refresh();
  return { refresh, close };
}
