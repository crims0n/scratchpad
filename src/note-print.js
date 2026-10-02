// SPDX-License-Identifier: GPL-3.0-or-later

export async function waitForPrintAssets(doc, timeoutMs = 10000) {
  const cleanups = [];
  let timer;
  try {
    const imagesReady = [...doc.images].map(image => {
      if (image.complete) return Promise.resolve();
      return new Promise(resolve => {
        const finished = () => resolve(); // Broken embedded images retain their alt text.
        image.addEventListener("load", finished, { once: true });
        image.addEventListener("error", finished, { once: true });
        cleanups.push(() => {
          image.removeEventListener("load", finished);
          image.removeEventListener("error", finished);
        });
      });
    });
    const interrupted = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timed out preparing the note for printing")), timeoutMs);
      const cancel = () => reject(new Error("Printing cancelled because the app is closing"));
      doc.defaultView.addEventListener("pagehide", cancel, { once: true });
      cleanups.push(() => doc.defaultView.removeEventListener("pagehide", cancel));
    });
    await Promise.race([Promise.all([doc.fonts?.ready, ...imagesReady]), interrupted]);
  } finally {
    clearTimeout(timer);
    cleanups.forEach(remove => remove());
  }
}

// Browser fallback: print the sanitized standalone document, not the app window. The
// frame is rendered offscreen (display:none can produce blank printouts), but
// excluded from focus and accessibility navigation. Scripts are not permitted.
export async function printNoteDocument(html, { doc = document, timeoutMs = 10000 } = {}) {
  const frame = doc.createElement("iframe");
  frame.title = "Note prepared for printing";
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("sandbox", "allow-same-origin allow-modals");
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0;pointer-events:none;";
  frame.dataset.notePrint = "";
  const previousFocus = doc.activeElement;
  const cleanups = [];
  const cleanup = () => {
    cleanups.splice(0).forEach(remove => remove());
    frame.remove();
  };
  try {
    doc.body.appendChild(frame);
    const printWindow = frame.contentWindow;
    const printDocument = frame.contentDocument;
    if (!printDocument || typeof printWindow?.print !== "function") {
      throw new Error("Printing is unavailable in this environment");
    }
    printDocument.open();
    printDocument.write(html);
    printDocument.close();

    await waitForPrintAssets(printDocument, timeoutMs);
    // Window.print blocks until its dialog closes; afterprint is also used so
    // the temporary note is removed promptly on print or cancellation.
    printWindow.addEventListener("afterprint", cleanup, { once: true });
    cleanups.push(() => printWindow.removeEventListener("afterprint", cleanup));
    printWindow.focus();
    await printWindow.print();
  } finally {
    cleanup();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
}
