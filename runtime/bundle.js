'use strict';

// Shared source generator for every early-runtime host: the browser extension's
// MAIN-world content script, the desktop preload, and the tests. Descriptor
// functions are emitted as source, so they must not close over module scope.
const install = require('./early');
const registry = require('./registry');

function literal(value) {
  if (typeof value === 'function') {
    const text = value.toString();
    // Method shorthand ("setup(api) {}") is not a valid expression on its own.
    if (!/^(async\s+)?(function\b|\()/.test(text) && !text.includes('=>'))
      throw new Error(`descriptor function must be a function expression or arrow: ${text.slice(0, 40)}`);
    return `(${text})`;
  }
  if (Array.isArray(value)) return `[${value.map(literal).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => `${JSON.stringify(key)}:${literal(entry)}`)
      .join(',')}}`;
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

function source(plugins = registry) {
  return `(${install.toString()})(${literal(plugins)});\n`;
}

// Settings metadata for the extension options page: data only, no functions.
function metadata(plugins = registry) {
  return plugins.map(({ id, description, defaultEnabled, settings }) => ({
    id,
    description: description || '',
    defaultEnabled: defaultEnabled === true,
    settings: Object.fromEntries(
      Object.entries(settings || {}).map(([name, schema]) => [
        name,
        Object.fromEntries(Object.entries(schema).filter(([key]) => key !== 'coerce')),
      ]),
    ),
  }));
}

module.exports = { literal, metadata, registry, source };
