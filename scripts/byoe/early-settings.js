'use strict';

// Serialized into the desktop preload; the existing settings remain authoritative.
module.exports = function installDesktopSettings(initial, send) {
  const runtime = window.__slickEarly;
  if (!runtime || window.__slickDesktopEarly) return;
  let state = initial;
  let active;
  let activation;
  const key = 'slick:nicknames';
  const ids = runtime.plugins.map((plugin) => plugin.id);
  function localNames() {
    try {
      return JSON.parse(localStorage.getItem(key)) || {};
    } catch {
      return {};
    }
  }
  // The first document migrates once. Even an empty persisted map is authoritative.
  if (state.nicknames === undefined) {
    state = send({ type: 'migrate-nicknames', names: localNames() }) || state;
  }
  function update(next) {
    if (!next) return;
    state = next;
    const names = { ...(state.nicknames === undefined ? localNames() : state.nicknames) };
    for (const id of Object.keys(names)) if (!names[id]) delete names[id];
    const enabled = state.enabled || [];
    const stored = state.settings || {};
    const plugins = {};
    for (const id of ids) {
      // A plugin whose early hooks were not observed stays on the legacy path.
      const on = enabled.includes(id) && (!active || active[id] === true);
      plugins[id] = { ...stored[id], enabled: on };
    }
    if (plugins.Nicknames) plugins.Nicknames.names = plugins.Nicknames.enabled ? names : {};
    runtime.configure({ enabled: true, plugins });
    try {
      localStorage.setItem(key, JSON.stringify(names));
      window.dispatchEvent(new StorageEvent('storage', { key }));
    } catch {}
  }
  function capabilities() {
    const diagnostics = runtime.diagnostics();
    const own = new Set(ids);
    // Interception installed after Slack captured references, or a failure
    // outside any single plugin, disqualifies the whole early path.
    const safe = !diagnostics.late && !diagnostics.errors.some((error) => !own.has(error.capability));
    const found = {};
    for (const plugin of runtime.plugins) {
      const failed = diagnostics.errors.some((error) => error.capability === plugin.id);
      const probe = plugin.probe ? plugin.probe(diagnostics) : diagnostics.installed[plugin.id] === true;
      found[plugin.id] = safe && !failed && probe === true;
    }
    return found;
  }
  function report() {
    const diagnostics = runtime.diagnostics();
    const selected = active || {};
    const enabled = new Set(state.enabled || []);
    const own = new Set(ids);
    const globalFailure = diagnostics.errors.some((error) => !own.has(error.capability));
    const plugins = {};
    for (const plugin of runtime.plugins) {
      let status = 'disabled';
      let reason = '';
      if (enabled.has(plugin.id)) {
        if (!active) status = 'pending';
        else if (selected[plugin.id]) status = 'early';
        else {
          status = 'legacy';
          if (diagnostics.late) reason = 'late injection';
          else if (globalFailure) reason = 'runtime error';
          else if (diagnostics.errors.some((error) => error.capability === plugin.id)) reason = 'plugin error';
          else reason = 'capability not observed';
        }
      }
      plugins[plugin.id] = { status, reason };
    }
    return {
      state: active ? 'settled' : 'pending',
      late: diagnostics.late === true,
      errorCount: diagnostics.errors.length,
      plugins,
    };
  }
  const waiting = () => (state.enabled || []).filter((id) => ids.includes(id));
  function finish() {
    if (!active) {
      active = capabilities();
      update(state);
    }
    return active;
  }
  window.__slickDesktopEarly = {
    update,
    activate(waitMs = 0) {
      if (active) return active;
      if (!waitMs) return finish();
      if (activation) return activation;
      const deadline = Date.now() + Math.min(waitMs, 1500);
      activation = new Promise((resolve) => {
        function check() {
          const found = capabilities();
          const diagnostics = runtime.diagnostics();
          if (
            diagnostics.late ||
            Date.now() >= deadline ||
            waiting().every((id) => found[id]) ||
            diagnostics.errors.some((error) => !ids.includes(error.capability))
          ) {
            resolve(finish());
          } else setTimeout(check, 50);
        }
        check();
      });
      return activation;
    },
    nickname(id, name) {
      update(send({ type: 'nickname', id, name }));
    },
    get active() {
      return active || {};
    },
    report,
  };
  update(state);
};
