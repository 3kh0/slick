'use strict';

// Live-reload watching for the settings and theme files.
//
// fs.watchFile polls stat() on a timer, and Slick ran four of them at 300ms for
// the entire life of the process. fs.watch is event-driven instead — backed by
// ReadDirectoryChangesW on Windows — so idle costs nothing.
//
// Two details this has to get right:
//   - Watch the containing directory, not the file. An atomic replace (write a
//     temp file, rename over the target) swaps the inode and silently detaches a
//     file-level watch; a directory watch keeps seeing it.
//   - Coalesce. Windows emits two or three events per logical change, and the
//     temp file in an atomic replace generates its own. Callers get one call per
//     real content change, filtered by an mtime comparison.

const fs = require('fs');
const path = require('path');

const DEBOUNCE_MS = 150;
const FALLBACK_POLL_MS = 1000;

function createWatcher({ debounceMs = DEBOUNCE_MS, onError = () => {} } = {}) {
  const directories = new Map();

  function directoryEntry(dir) {
    let entry = directories.get(dir);
    if (entry) return entry;
    entry = { listeners: new Map(), watcher: null };
    directories.set(dir, entry);
    try {
      fs.mkdirSync(dir, { recursive: true });
      entry.watcher = fs.watch(dir, (_event, changed) => {
        const name = changed ? path.basename(String(changed)) : '';
        // A null filename means "something in here changed" — notify everyone.
        for (const [key, listener] of entry.listeners) {
          if (!name || key === name) listener();
        }
      });
      entry.watcher.on('error', (error) => onError(dir, error));
    } catch (error) {
      onError(dir, error);
      entry.watcher = null;
    }
    return entry;
  }

  // Returns a disposer.
  function watch(file, onChange) {
    const dir = path.dirname(file);
    const base = path.basename(file);
    const entry = directoryEntry(dir);

    const mtime = () => {
      try {
        return fs.statSync(file).mtimeMs;
      } catch {
        return 0;
      }
    };

    let seen = mtime();
    let timer = null;
    const fire = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const current = mtime();
        if (current === seen) return;
        seen = current;
        onChange();
      }, debounceMs);
    };

    let poll = null;
    if (entry.watcher) {
      entry.listeners.set(base, fire);
    } else {
      // No usable directory watch (rare, e.g. some network paths). Poll, but at
      // a far lower rate than the 300ms this replaced.
      poll = (curr, previous) => {
        if (curr.mtimeMs !== previous.mtimeMs) onChange();
      };
      fs.watchFile(file, { interval: FALLBACK_POLL_MS }, poll);
    }

    return () => {
      entry.listeners.delete(base);
      clearTimeout(timer);
      if (poll) fs.unwatchFile(file, poll);
    };
  }

  function close() {
    for (const entry of directories.values()) {
      try {
        entry.watcher?.close();
      } catch {}
      entry.listeners.clear();
    }
    directories.clear();
  }

  return { close, watch };
}

module.exports = { DEBOUNCE_MS, createWatcher };
