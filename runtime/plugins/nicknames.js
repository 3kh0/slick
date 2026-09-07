'use strict';

module.exports = {
  id: 'Nicknames',
  description: 'Local display names for members, applied to state reads and message senders.',
  defaultEnabled: true,
  settings: {
    names: { type: 'names', label: 'Local nicknames', default: {} },
  },
  // A projected store alone does not prove reactive labels; require both.
  probe: function probe(diagnostics) {
    return diagnostics.stores > 0 && !!diagnostics.componentHits.BaseMessageSender;
  },
  setup: function setup(api) {
    const wrapped = new WeakSet();
    function wrapStore(store) {
      if (!store || typeof store.getState !== 'function' || typeof store.dispatch !== 'function' || wrapped.has(store))
        return store;
      wrapped.add(store);
      const getState = store.getState;
      let lastRaw;
      let lastVersion = -1;
      let projected;
      let memberCache = new WeakMap();
      let sliceCache = new WeakMap();
      store.getState = function () {
        const raw = getState.call(this);
        const nicknames = api.settings.names;
        if (!api.enabled || !raw?.members || !Object.keys(nicknames).length) return raw;
        if (raw === lastRaw && lastVersion === api.version) return projected;
        if (lastVersion !== api.version) {
          memberCache = new WeakMap();
          sliceCache = new WeakMap();
        }
        let members = sliceCache.get(raw.members);
        if (!members) {
          members = new Proxy(raw.members, {
            get(target, key, receiver) {
              const member = Reflect.get(target, key, receiver);
              if (typeof key !== 'string' || !Object.hasOwn(nicknames, key) || !member?.profile) return member;
              // Respect Proxy invariants for frozen own properties.
              const descriptor = Object.getOwnPropertyDescriptor(target, key);
              if (descriptor && !descriptor.configurable && descriptor.writable === false) return member;
              let next = memberCache.get(member);
              if (!next) {
                const name = nicknames[key];
                const normalized = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
                next = {
                  ...member,
                  real_name: name,
                  _display_name_lc: name.toLowerCase(),
                  _real_name_lc: name.toLowerCase(),
                  _display_name_normalized_lc: normalized.toLowerCase(),
                  _real_name_normalized_lc: normalized.toLowerCase(),
                  profile: {
                    ...member.profile,
                    display_name: name,
                    display_name_normalized: normalized,
                    real_name: name,
                    real_name_normalized: normalized,
                  },
                };
                memberCache.set(member, next);
              }
              return next;
            },
          });
          sliceCache.set(raw.members, members);
        }
        lastRaw = raw;
        lastVersion = api.version;
        projected = { ...raw, members };
        return projected;
      };
      api.trackStore(store);
      api.installed(true);
      return store;
    }
    api.component('BaseMessageSender', (props) => {
      const id = props?.userId || props?.memberId;
      const name = id && api.settings.names[id];
      if (!name || props.overrideNameText === name) return props;
      return { ...props, overrideNameText: name };
    });

    function readExport(exports, candidate, descriptor) {
      if (descriptor && Object.hasOwn(descriptor, 'value')) return descriptor.value;
      if (!descriptor?.get) return;
      // Only read the observed identifier-only ESM binding form. A short
      // getter can still call require() or execute arbitrary work.
      try {
        if (!/^\(\s*\)\s*=>\s*[A-Za-z_$][\w$]*$/.test(Function.prototype.toString.call(descriptor.get).trim())) return;
        return exports[candidate];
      } catch {
        return;
      }
    }

    api.onExports((exports) => {
      if (!exports || typeof exports !== 'object') return exports;
      const read = (key) => readExport(exports, key, Object.getOwnPropertyDescriptor(exports, key));
      if (typeof read('getState') === 'function' && typeof read('dispatch') === 'function') return wrapStore(exports);
      let key;
      for (const candidate of Object.keys(exports)) {
        const descriptor = Object.getOwnPropertyDescriptor(exports, candidate);
        const value = readExport(exports, candidate, descriptor);
        if (typeof value === 'function' && (candidate === 'createStore' || value.name === 'createStore')) {
          key = candidate;
          break;
        }
      }
      if (!key) return exports;
      const descriptor = Object.getOwnPropertyDescriptor(exports, key);
      const original = exports[key];
      if (typeof original !== 'function' || wrapped.has(original)) return exports;
      function createStore(...args) {
        return wrapStore(original.apply(this, args));
      }
      wrapped.add(createStore);
      const descriptors = Object.getOwnPropertyDescriptors(exports);
      descriptors[key] = { value: createStore, enumerable: descriptor.enumerable, writable: true, configurable: true };
      return Object.create(Object.getPrototypeOf(exports), descriptors);
    });
  },
};
