'use strict';

// ClearURLs provider rules are fetched here, in the extension world, and handed
// to the page through the same one-way settings bridge as everything else. The
// page never gets network privileges of its own.
const SOURCE = 'https://raw.githubusercontent.com/ClearURLs/Rules/master/data.min.json';
const MAX_AGE = 12 * 60 * 60 * 1000;

async function wanted() {
  const { config } = await chrome.storage.local.get('config');
  if (config?.enabled === false) return false;
  const entry = config?.plugins?.ClearURLs;
  return entry ? entry.enabled !== false : false;
}

async function refresh(force = false) {
  if (!(await wanted())) return;
  const { clearUrlsRules } = await chrome.storage.local.get('clearUrlsRules');
  if (!force && clearUrlsRules?.fetchedAt && Date.now() - clearUrlsRules.fetchedAt < MAX_AGE) return;
  try {
    const response = await fetch(SOURCE, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data || typeof data.providers !== 'object') throw new Error('unexpected payload');
    await chrome.storage.local.set({ clearUrlsRules: { fetchedAt: Date.now(), data } });
  } catch (error) {
    console.warn('[slick-early] ClearURLs rules unavailable:', error.message);
  }
}

chrome.runtime.onInstalled.addListener(() => refresh(true));
chrome.runtime.onStartup.addListener(() => refresh());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.config) refresh();
});
refresh();
