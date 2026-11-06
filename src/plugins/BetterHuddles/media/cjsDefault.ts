/**
 * The value a CommonJS module exported as `exports.default`.
 *
 * Under `"type": "module"` a CommonJS file's default import is its whole
 * `module.exports` object (Node's rule, which esbuild follows), so the class sits
 * one `.default` further in. Already-unwrapped values pass through.
 *
 * Args:
 *   imported: the default import of a CommonJS module built from TypeScript.
 * Returns:
 *   its `exports.default`, typed as TypeScript believes the import to be.
 */
export function cjsDefault<T>(imported: T): T {
  const moduleExports = imported as { __esModule?: boolean; default?: T } | null;
  return moduleExports?.__esModule && moduleExports.default !== undefined ? moduleExports.default : imported;
}
