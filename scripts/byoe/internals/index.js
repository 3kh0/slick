'use strict';

function slickInternalsMain() {
  if (window.__slickInternals) return;

  var chunkArray = window.webpackChunkwebapp;
  if (!Array.isArray(chunkArray)) {
    console.error('[slick-internals] webpackChunkwebapp not present, internals unavailable');
    return;
  }

  var webpackRequire = null;
  try {
    chunkArray.push([
      ['__slick_internals__'],
      {},
      function (require) {
        webpackRequire = require;
      },
    ]);
  } catch (e) {
    console.error('[slick-internals] could not acquire webpack require:', e && e.message);
    return;
  }
  if (typeof webpackRequire !== 'function' || !webpackRequire.m) {
    console.error('[slick-internals] webpack require has no module map');
    return;
  }

  // futres chunk yoink
  var futureRegistry = new Map();
  var chunkCbs = [];
  // Keep original factory references so source-signature discovery still sees
  // Slack's code (the wrapped factory's own source is just our shim).
  var originalFactories = new Map();
  var originalPush = chunkArray.push.bind(chunkArray);
  function wrapFactory(id, factory) {
    originalFactories.set(id, factory);
    return function (module, exports, require) {
      var result = factory.call(this, module, exports, require);
      try {
        futureRegistry.set(id, module.exports);
        for (var i = 0; i < chunkCbs.length; i++) chunkCbs[i](module.exports, id);
      } catch (e) {}
      return result;
    };
  }
  var patchedPush = function () {
    for (var c = 0; c < arguments.length; c++) {
      var chunk = arguments[c];
      if (Array.isArray(chunk) && chunk[1] && typeof chunk[1] === 'object') {
        var mods = chunk[1];
        for (var id in mods) {
          if (Object.prototype.hasOwnProperty.call(mods, id) && typeof mods[id] === 'function') {
            mods[id] = wrapFactory(id, mods[id]);
          }
        }
      }
    }
    return originalPush.apply(this, arguments);
  };
  chunkArray.push = patchedPush;
  function restorePush() {
    if (chunkArray.push === patchedPush) chunkArray.push = originalPush;
  }

  // module dig
  function findFactoryIds(needle) {
    var test =
      needle instanceof RegExp
        ? function (s) {
            return needle.test(s);
          }
        : function (s) {
            return s.indexOf(needle) !== -1;
          };
    var hits = [];
    var m = webpackRequire.m;
    for (var id in m) {
      if (!Object.prototype.hasOwnProperty.call(m, id)) continue;
      try {
        var factory = originalFactories.get(id) || m[id];
        if (test(Function.prototype.toString.call(factory))) hits.push(id);
      } catch (e) {}
    }
    return hits;
  }

  // this force instantiation is needed to patch internals before slacks code runs. use sparingly, as it may have silly side effects
  function requireById(id) {
    try {
      return webpackRequire(id);
    } catch (e) {
      return null;
    }
  }
  function cachedExports() {
    var out = [];
    var cache = webpackRequire.c || {};
    for (var id in cache) {
      if (!Object.prototype.hasOwnProperty.call(cache, id)) continue;
      try {
        out.push(cache[id].exports);
      } catch (e) {}
    }
    var seenFuture = futureRegistry.values();
    var entry;
    while (!(entry = seenFuture.next()).done) out.push(entry.value);
    return out;
  }
  function findExport(predicate) {
    var seen = cachedExports();
    for (var i = 0; i < seen.length; i++) {
      var exp = seen[i];
      try {
        if (predicate(exp)) return exp;
      } catch (e) {}
      if (!exp || (typeof exp !== 'object' && typeof exp !== 'function')) continue;
      for (var k in exp) {
        try {
          if (predicate(exp[k])) return exp[k];
        } catch (e) {}
      }
    }
    return null;
  }

  var isReact = function (exp) {
    return exp && typeof exp.createElement === 'function' && typeof exp.useState === 'function'
      ? exp
      : exp &&
          exp.default &&
          typeof exp.default.createElement === 'function' &&
          typeof exp.default.useState === 'function'
        ? exp.default
        : null;
  };
  var isJsxRuntime = function (e) {
    return e && typeof e === 'object' && typeof e.jsx === 'function' && typeof e.jsxs === 'function' && 'Fragment' in e;
  };

  var reactCache = null;
  function getReact() {
    if (reactCache) return reactCache;
    var R = findExport(isReact);
    if (R && R.default && typeof R.default.createElement === 'function') R = R.default;
    if (R) {
      reactCache = R;
      return R;
    }
    return null;
  }

  var jsxCache = null;
  function getJsxRuntime() {
    if (jsxCache) return jsxCache;
    var found = findExport(isJsxRuntime);
    if (found) {
      jsxCache = found;
      return found;
    }
    return null;
  }

  function probeExport(exp) {
    var candidates = [exp];
    if (exp && (typeof exp === 'object' || typeof exp === 'function')) {
      for (var k in exp) {
        try {
          candidates.push(exp[k]);
        } catch (e) {}
      }
    }
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      try {
        if (!reactCache) {
          var R = isReact(c);
          if (R) reactCache = R;
        }
        if (!jsxCache && isJsxRuntime(c)) jsxCache = c;
      } catch (e) {}
    }
  }

  function componentName(type) {
    if (typeof type === 'function') return type.displayName || type.name || null;
    if (type && typeof type === 'object' && type.displayName) return type.displayName;
    return null;
  }

  var propPatchers = []; // { matcher, transform }
  var replacers = new Map(); // matcher -> replacer
  var resolveCache = new WeakMap();

  var ORIGINAL = Symbol.for('slick.originalComponent');
  var markerCache = new WeakMap();
  function originalMarker(type) {
    if ((typeof type !== 'object' && typeof type !== 'function') || type === null) return type;
    if (markerCache.has(type)) return markerCache.get(type);
    var marker = { $$typeof: ORIGINAL, original: type };
    markerCache.set(type, marker);
    return marker;
  }
  function resolveType(type) {
    if (type && typeof type === 'object' && type.$$typeof === ORIGINAL) return type.original;
    if (replacers.size === 0) return type;
    var cacheable = (typeof type === 'function' || typeof type === 'object') && type !== null;
    if (cacheable && resolveCache.has(type)) return resolveCache.get(type);
    var resolved = type;
    replacers.forEach(function (replacer, matcher) {
      try {
        if (matcher(type)) resolved = replacer(resolved === type ? originalMarker(type) : resolved);
      } catch (e) {}
    });
    if (cacheable) resolveCache.set(type, resolved);
    return resolved;
  }
  function applyProps(type, props) {
    if (propPatchers.length === 0) return props;
    var out = props;
    for (var i = 0; i < propPatchers.length; i++) {
      try {
        if (propPatchers[i].matcher(type)) out = propPatchers[i].transform(out, type) || out;
      } catch (e) {}
    }
    return out;
  }
  function refresh() {
    try {
      window.dispatchEvent(new Event('resize'));
    } catch (e) {}
    var container = document.querySelector('.p-client_container');
    if (!container) return;
    var key = Object.keys(container).find(function (k) {
      return k.indexOf('__reactContainer$') === 0;
    });
    if (!key) return;
    var guard = 0;
    (function poison(n) {
      if (!n || guard++ > 50000) return;
      if (n.memoizedProps && typeof n.memoizedProps === 'object') {
        var patched = applyProps(n.type, n.memoizedProps);
        n.memoizedProps = patched === n.memoizedProps ? Object.assign({}, n.memoizedProps) : patched;
        if (n.pendingProps && typeof n.pendingProps === 'object') {
          var pending = applyProps(n.type, n.pendingProps);
          n.pendingProps = pending === n.pendingProps ? Object.assign({}, n.pendingProps) : pending;
        }
      }
      poison(n.child);
      poison(n.sibling);
    })(container[key]);
  }
  var ceHooked = false;
  var jsxHooked = false;
  function wrapTargets() {
    var changed = false;
    var React = reactCache;
    if (!ceHooked && React && React.createElement) {
      var oce = React.createElement;
      React.createElement = function (type, props) {
        arguments[0] = resolveType(type);
        arguments[1] = applyProps(type, props);
        return oce.apply(this, arguments);
      };
      ceHooked = true;
      changed = true;
    }
    var rt = jsxCache;
    if (!jsxHooked && rt) {
      var wrap = function (orig) {
        return function (type, props) {
          arguments[0] = resolveType(type);
          arguments[1] = applyProps(type, props);
          return orig.apply(this, arguments);
        };
      };
      rt.jsx = wrap(rt.jsx);
      rt.jsxs = wrap(rt.jsxs);
      jsxHooked = true;
      changed = true;
    }
    if (changed && (propPatchers.length || replacers.size)) refresh();
    return ceHooked && jsxHooked;
  }
  function installRenderHook() {
    getReact();
    getJsxRuntime();
    return wrapTargets();
  }

  var sigTried = false;
  function recoverBySignature() {
    if (sigTried || (reactCache && jsxCache)) return;
    sigTried = true;
    try {
      var ids = findFactoryIds('react.transitional.element');
      if (!ids.length || ids.length > 8) return;
      for (var i = 0; i < ids.length; i++) probeExport(requireById(ids[i]));
    } catch (e) {}
  }
  var hookPending = false;
  function ensureRenderHook() {
    if ((ceHooked && jsxHooked) || installRenderHook()) return;
    if (hookPending) return;
    hookPending = true;
    var off = function () {};
    var settle = function () {
      if (installRenderHook()) {
        hookPending = false;
        off();
        return true;
      }
      return false;
    };

    var onChunkModule = function (exports) {
      probeExport(exports);
      if (!reactCache && !jsxCache) return false;
      if (wrapTargets()) {
        hookPending = false;
        off();
        return true;
      }
      return false;
    };
    off = (function () {
      chunkCbs.push(onChunkModule);
      return function () {
        var i = chunkCbs.indexOf(onChunkModule);
        if (i >= 0) chunkCbs.splice(i, 1);
      };
    })();
    var tries = 0;
    var timer = setInterval(function () {
      if (++tries === 20) recoverBySignature();
      if (settle() || tries > 300) clearInterval(timer);
    }, 100);
  }

  // patchProps(displayName, transform): modify the props of every <displayName>
  // before render. transform(props, type) -> props. Reversible.
  function patchProps(displayName, transform) {
    ensureRenderHook();
    var entry = {
      matcher: function (type) {
        return componentName(type) === displayName;
      },
      transform: transform,
    };
    propPatchers.push(entry);
    refresh();
    return function dispose() {
      var i = propPatchers.indexOf(entry);
      if (i >= 0) propPatchers.splice(i, 1);
      refresh();
    };
  }

  function patchComponent(displayName, replacer) {
    ensureRenderHook();
    var matcher = function (type) {
      return componentName(type) === displayName;
    };
    replacers.set(matcher, replacer);
    resolveCache = new WeakMap();
    refresh();
    return function dispose() {
      replacers.delete(matcher);
      resolveCache = new WeakMap();
      refresh();
    };
  }

  window.__slickInternals = {
    version: 1,
    modules: {
      getRequire: function () {
        return webpackRequire;
      },
      findFactoryIds: findFactoryIds,
      requireById: requireById,
      findExport: findExport,
      onChunk: function (cb) {
        chunkCbs.push(cb);
        return function () {
          var i = chunkCbs.indexOf(cb);
          if (i >= 0) chunkCbs.splice(i, 1);
        };
      },
      futureRegistry: futureRegistry,
    },
    react: {
      get: getReact,
      getJsxRuntime: getJsxRuntime,
      patchProps: patchProps,
      patchComponent: patchComponent,
      refresh: refresh,
    },
    dispose: function () {
      restorePush();
      replacers.clear();
      propPatchers.length = 0;
      resolveCache = new WeakMap();
      refresh();
    },
  };
  console.log('[slick-internals] ready (' + Object.keys(webpackRequire.m).length + ' module factories discoverable)');
}

module.exports = {
  enabled: function () {
    return process.env.SLICK_INTERNALS === '1';
  },
  source: '(' + slickInternalsMain.toString() + ')();',
};
