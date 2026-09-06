'use strict';

// The plugin list and its settings schema come from the built runtime bundle, so
// this page never needs updating when a plugin is ported.
const catalog = (globalThis.SLICK_EARLY_PLUGINS || []).filter((plugin) => plugin.id);
const form = document.querySelector('#settings');
const status = document.querySelector('#status');
const host = document.querySelector('#plugins');
const NAME_LINE = /^\s*([UW][A-Z0-9]+)\s*=\s*(.{1,100}?)\s*$/;
const field = (plugin, name) => `${plugin.id}.${name}`;
// Settings the platform supplies (fetched rule sets and the like) are not typed in here.
const editable = (schema) => schema.platform !== true;

function control(plugin, name, schema) {
  const wrap = document.createElement('div');
  wrap.className = 'setting';
  const id = field(plugin, name);
  const type = schema.type || 'text';
  let input;
  if (type === 'boolean') {
    input = document.createElement('input');
    input.type = 'checkbox';
  } else if (type === 'select') {
    input = document.createElement('select');
    for (const option of schema.options || []) {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      input.append(element);
    }
  } else if (type === 'number') {
    input = document.createElement('input');
    input.type = 'number';
    if (schema.min !== undefined) input.min = schema.min;
    if (schema.max !== undefined) input.max = schema.max;
  } else if (type === 'names') {
    input = document.createElement('textarea');
    input.rows = 6;
    input.spellcheck = false;
  } else {
    input = document.createElement('input');
    input.type = 'text';
  }
  input.name = id;
  input.id = id;
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = schema.label || name;
  if (type === 'boolean') {
    label.prepend(input);
    wrap.append(label);
  } else {
    wrap.append(label, input);
  }
  if (schema.description) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = schema.description;
    wrap.append(hint);
  }
  if (type === 'names') {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent =
      'One member ID and nickname per line: U0123456789 = Alex. Find the ID in a Slack profile’s More menu → Copy member ID.';
    wrap.append(hint);
  }
  return wrap;
}

for (const plugin of catalog) {
  const section = document.createElement('fieldset');
  const legend = document.createElement('legend');
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.name = field(plugin, 'enabled');
  legend.append(toggle, document.createTextNode(` ${plugin.id}`));
  section.append(legend);
  if (plugin.description) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = plugin.description;
    section.append(hint);
  }
  for (const [name, schema] of Object.entries(plugin.settings))
    if (editable(schema)) section.append(control(plugin, name, schema));
  host.append(section);
}

function load(config = {}) {
  form.elements.enabled.checked = config.enabled !== false;
  for (const plugin of catalog) {
    const stored = config.plugins?.[plugin.id] || {};
    const present = config.plugins && Object.hasOwn(config.plugins, plugin.id);
    form.elements[field(plugin, 'enabled')].checked = present ? stored.enabled !== false : plugin.defaultEnabled;
    for (const [name, schema] of Object.entries(plugin.settings)) {
      if (!editable(schema)) continue;
      const input = form.elements[field(plugin, name)];
      const value = Object.hasOwn(stored, name) ? stored[name] : schema.default;
      if (schema.type === 'boolean') input.checked = value === true;
      else if (schema.type === 'names')
        input.value = Object.entries(value || {})
          .map(([member, nickname]) => `${member} = ${nickname}`)
          .join('\n');
      else input.value = value ?? '';
    }
  }
}

function collect() {
  const plugins = {};
  for (const plugin of catalog) {
    const entry = { enabled: form.elements[field(plugin, 'enabled')].checked };
    for (const [name, schema] of Object.entries(plugin.settings)) {
      if (!editable(schema)) continue;
      const input = form.elements[field(plugin, name)];
      if (schema.type === 'boolean') entry[name] = input.checked;
      else if (schema.type === 'number') entry[name] = Number(input.value);
      else if (schema.type === 'names') {
        const names = {};
        for (const line of input.value.split('\n')) {
          if (!line.trim()) continue;
          const match = line.match(NAME_LINE);
          if (!match) throw new Error(`${plugin.id}: use MEMBER_ID = nickname on each line (up to 100 characters).`);
          names[match[1]] = match[2];
        }
        entry[name] = names;
      } else entry[name] = input.value;
    }
    plugins[plugin.id] = entry;
  }
  return { enabled: form.elements.enabled.checked, plugins };
}

chrome.storage.local.get('config').then(({ config }) => load(config));
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  let config;
  try {
    config = collect();
  } catch (error) {
    status.textContent = error.message;
    return;
  }
  try {
    await chrome.storage.local.set({ config });
    status.textContent = 'Saved. Open Slack tabs have been updated.';
  } catch {
    status.textContent = 'Could not save settings. Please try again.';
  }
});
