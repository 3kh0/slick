'use strict';

// One-way settings delivery. Page scripts cannot request privileged operations.
(() => {
  const merge = (config, rules) => {
    const next = { ...config, plugins: { ...config?.plugins } };
    // Platform-supplied settings are attached here, not typed in by the user.
    if (rules?.data) next.plugins.ClearURLs = { ...next.plugins.ClearURLs, rules: rules.data };
    return next;
  };
  const send = (config, rules) =>
    window.postMessage({ type: 'slick-early-settings', config: merge(config || {}, rules) }, location.origin);
  let current = {};
  let currentRules = null;
  chrome.storage.local.get(['config', 'clearUrlsRules']).then(({ config, clearUrlsRules }) => {
    current = config || {};
    currentRules = clearUrlsRules || null;
    send(current, currentRules);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!changes.config && !changes.clearUrlsRules) return;
    if (changes.config) current = changes.config.newValue || {};
    if (changes.clearUrlsRules) currentRules = changes.clearUrlsRules.newValue || null;
    send(current, currentRules);
  });
})();
