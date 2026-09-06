// SPDX-License-Identifier: GPL-3.0-or-later

export const UPDATE_PREFERENCES_KEY = "scratchpad_update_preferences";
export const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_LAUNCH_DELAY_MS = 5000;

export function readUpdatePreferences(storage) {
  try {
    const value = JSON.parse(storage.getItem(UPDATE_PREFERENCES_KEY));
    return {
      automatic: value?.automatic === true,
      lastCheck: Number.isFinite(value?.lastCheck) && value.lastCheck > 0 ? value.lastCheck : null,
      skippedVersion: typeof value?.skippedVersion === "string" ? value.skippedVersion : null
    };
  } catch {
    return { automatic: false, lastCheck: null, skippedVersion: null };
  }
}

// Own the clock and persistence independently of dialogs and editor state.
export function createUpdateChecker({ invoke, storage, onChange = () => {}, now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  let preferences = readUpdatePreferences(storage);
  let state = { ...preferences, info: null, status: "idle", release: null, preferenceError: "" };
  let timer = null;
  let pending = null;
  let manualRequested = false;
  let generation = 0;
  let disposed = false;
  const snapshot = () => ({ ...state, indicator: Boolean(state.release && state.release.version !== state.skippedVersion) });
  const emit = () => { if (!disposed) onChange(snapshot()); };

  function save(next) {
    try {
      storage.setItem(UPDATE_PREFERENCES_KEY, JSON.stringify(next));
      preferences = next;
      Object.assign(state, next, { preferenceError: "" });
      return true;
    } catch {
      state.preferenceError = "Update preferences could not be saved. Please try again.";
      return false;
    }
  }

  function schedule(launch = false) {
    clearTimer(timer);
    timer = null;
    if (disposed || !state.automatic || pending) return;
    // A future timestamp can result from a clock correction; cap it at one day.
    const remaining = state.lastCheck === null ? 0 : Math.min(UPDATE_INTERVAL_MS, Math.max(0, state.lastCheck + UPDATE_INTERVAL_MS - now()));
    timer = setTimer(() => { timer = null; void check(false); }, Math.max(launch ? UPDATE_LAUNCH_DELAY_MS : 0, remaining));
  }

  async function loadInfo() {
    const info = await invoke("get_update_info");
    if (!info || typeof info.installedVersion !== "string" || !["beta", "stable"].includes(info.channel)) throw new Error("Missing installed version");
    state.info = info;
  }

  function check(manual = true) {
    if (disposed || (!manual && !state.automatic)) return Promise.resolve();
    manualRequested ||= manual;
    if (pending) { emit(); return pending; }
    clearTimer(timer);
    timer = null;
    const requestGeneration = generation;
    state.status = "checking";
    // Throttle attempts, including offline failures, across application launches.
    const timestamp = now();
    save({ ...preferences, lastCheck: timestamp });
    preferences = { ...preferences, lastCheck: timestamp };
    state.lastCheck = timestamp;
    emit();
    pending = (async () => {
      try {
        if (!state.info) await loadInfo();
        if (disposed || (requestGeneration !== generation && !manualRequested)) return;
        const release = await invoke("check_for_updates");
        if (disposed || (requestGeneration !== generation && !manualRequested)) return;
        state.release = release && (manualRequested || release.version !== state.skippedVersion) ? release : null;
        state.status = state.release ? "available" : release ? "skipped" : "current";
      } catch {
        if (disposed || (requestGeneration !== generation && !manualRequested)) return;
        // No toast or dialog for background failures. The panel remains retryable.
        state.status = "error";
      } finally {
        pending = null;
        manualRequested = false;
        emit();
        schedule();
      }
    })();
    return pending;
  }

  function setAutomatic(automatic) {
    const saved = save({ ...preferences, automatic });
    if (saved || !automatic) {
      // Opting out takes effect for this session even if storage is unavailable.
      state.automatic = automatic;
      preferences = { ...preferences, automatic };
      generation += 1;
      if (!automatic && pending && !manualRequested) state.status = state.release ? "available" : "idle";
      schedule(true);
    }
    emit();
  }

  function skip() {
    if (state.release && save({ ...preferences, skippedVersion: state.release.version })) {
      state.release = null;
      state.status = "skipped";
    }
    emit();
  }

  async function openRelease() {
    if (!state.release) return;
    try {
      await invoke("open_update_release", { url: state.release.url });
    } catch {
      state.preferenceError = "Could not open the release page. Please try again.";
      emit();
    }
  }

  const ready = loadInfo().catch(() => {}).then(() => { emit(); schedule(true); });
  return { ready, check, setAutomatic, skip, openRelease, snapshot,
    dispose() { disposed = true; generation += 1; clearTimer(timer); }
  };
}

export function createUpdateUi({ document, invoke, storage, closeAbout }) {
  const byId = (id) => document.getElementById(id);
  let displayedVersion = null;
  const checker = createUpdateChecker({ invoke, storage,
    onChange(state) {
      byId("update-channel").textContent = state.info ? (state.info.channel === "beta" ? "Beta" : "Stable") : "Unavailable";
      if (state.info) byId("about-version").textContent = state.info.installedVersion;
      byId("update-last-check").textContent = state.lastCheck ? new Date(state.lastCheck).toLocaleString() : "Never";
      byId("update-automatic").checked = state.automatic;
      byId("update-preference-error").textContent = state.preferenceError;
      const messages = {
        idle: "", checking: "Checking for updates…",
        current: "You’re up to date on this release channel.",
        available: `Scratchpad ${state.release?.version} is available.`,
        skipped: `Version ${state.skippedVersion} is skipped. A manual check will show it again.`,
        error: "Unable to check for updates. Check your connection and try again."
      };
      byId("update-status").textContent = messages[state.status];
      byId("update-check-btn").disabled = state.status === "checking";
      byId("update-skip-btn").disabled = state.status === "checking";
      byId("update-check-btn").textContent = state.status === "error" ? "Retry" : "Check for Updates…";
      byId("update-available").hidden = !state.release;
      byId("update-menu-indicator").hidden = !state.indicator;
      byId("actions-btn").classList.toggle("has-update", state.indicator);
      byId("actions-btn").setAttribute("aria-label", state.indicator ? "Open Scratchpad menu — update available" : "Open Scratchpad menu");
      if (displayedVersion !== state.release?.version) {
        displayedVersion = state.release?.version;
        byId("update-release-notes").open = false;
      }
      // Release notes are untrusted text, never injected HTML or remote images.
      byId("update-notes-content").textContent = state.release?.notes || "No release notes were provided for this version.";
    }
  });
  byId("update-check-btn").addEventListener("click", () => { void checker.check(); });
  byId("update-automatic").addEventListener("change", (event) => checker.setAutomatic(event.target.checked));
  byId("update-download-btn").addEventListener("click", () => { void checker.openRelease(); });
  byId("update-skip-btn").addEventListener("click", () => {
    checker.skip();
    if (byId("update-available").hidden) byId("update-check-btn").focus();
  });
  byId("update-later-btn").addEventListener("click", closeAbout);
  return checker;
}
