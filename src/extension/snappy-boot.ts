// Dynamically registered at document_start only when Snappy's startup gate opt-in is enabled.
(() => {
  const g = globalThis as Record<PropertyKey, unknown>;
  const late = Symbol.for('slick.snappyLate');
  Object.defineProperty(g, Symbol.for('slick.snappyOptIn'), { value: true, configurable: true });
  const fn = g[late];
  if (typeof fn === 'function') {
    delete g[late];
    (fn as () => void)();
  }
})();
