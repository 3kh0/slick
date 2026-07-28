'use strict';

// Electron can report the same hang more than once before the renderer recovers.
// Slack opens a native dialog for every BrowserWindow event, so overlapping
// reports can leave multiple recovery dialogs on screen. Keep WebContents
// events intact for diagnostics while exposing the window hang as one edge.
function coalesceWindowHangEvents(win) {
  const emit = win.emit;
  let unresponsive = false;

  win.emit = function coalescedWindowEmit(event, ...args) {
    if (event === 'unresponsive') {
      if (unresponsive) return false;
      unresponsive = true;
    } else if (event === 'responsive') {
      unresponsive = false;
    }

    return emit.call(this, event, ...args);
  };
}

module.exports = { coalesceWindowHangEvents };
