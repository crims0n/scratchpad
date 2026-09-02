// SPDX-License-Identifier: GPL-3.0-or-later

export function createEditorRenderScheduler(
  render,
  { requestFrame, cancelFrame } = {}
) {
  let pending = false;
  let frameId = null;

  return {
    schedule() {
      if (pending) return;

      if (typeof requestFrame !== "function") {
        render();
        return;
      }

      pending = true;
      frameId = requestFrame(() => {
        pending = false;
        frameId = null;
        render();
      });
    },

    cancel() {
      if (!pending) return;
      if (typeof cancelFrame === "function" && frameId !== null) {
        cancelFrame(frameId);
      }
      pending = false;
      frameId = null;
    }
  };
}
