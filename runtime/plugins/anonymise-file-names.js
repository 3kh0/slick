'use strict';

const legacy = require('../../plugins/AnonymiseFileNames');

module.exports = {
  id: 'AnonymiseFileNames',
  description: legacy.meta.description,
  defaultEnabled: false,
  settings: {},
  setup: function setup(api) {
    if (typeof File !== 'function') return api.installed(false);
    const descriptor = Object.getOwnPropertyDescriptor(File.prototype, 'name');
    if (!descriptor || typeof descriptor.get !== 'function' || !descriptor.configurable) return api.installed(false);
    const original = descriptor.get;
    const random = (length) => {
      const values = new Uint32Array(length);
      if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(values);
      else for (let i = 0; i < length; i++) values[i] = (Math.random() * 0xffffffff) >>> 0;
      return values;
    };
    const stem = () => {
      const values = random(7);
      let out = '';
      for (let i = 0; i < 7; i++) out += 'abcdefghijklmnopqrstuvwxyz0123456789'[values[i] % 36];
      return out;
    };
    const extension = (name) => {
      if (typeof name !== 'string') return '';
      const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
      const dot = base.lastIndexOf('.');
      return dot > 0 ? base.slice(dot) : '';
    };
    const alreadyMasked = (name) => typeof name === 'string' && /^[a-z0-9]{7}(\.[^./\\]+)?$/.test(name);
    // One stable name per File object: Slack reads .name more than once per upload
    // and a fresh name on every read breaks its own bookkeeping.
    const masked = new WeakMap();
    // The property stays patched while the plugin is off so toggling does not
    // need a reload; the getter falls through to the real name instead.
    Object.defineProperty(File.prototype, 'name', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: function name() {
        const real = original.call(this);
        if (!api.enabled) return real;
        let value = masked.get(this);
        if (value !== undefined) return value;
        value = alreadyMasked(real) ? real : stem() + extension(real);
        masked.set(this, value);
        api.count('renamed');
        return value;
      },
    });
    api.installed(true);
  },
};
