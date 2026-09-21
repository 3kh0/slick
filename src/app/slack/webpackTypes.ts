// Shapes of Slack's webpack/rspack runtime that Slick actually intercepts.
// Deliberately minimal: only the parts webpack.ts touches are described, so a
// change in a field we never read cannot make this file wrong.

export type Exports = Record<string, any>;

export type WebpackModule = {
  id: PropertyKey;
  loaded: boolean;
  exports: Exports;
};

/** Invoked by the runtime the first time a module is required. */
export type ModuleFactory = (module: WebpackModule, exports: Exports, require: WebpackRequire) => void;

/** `[chunkIds, modules, runtime?]`, as pushed onto the chunk global. */
export type Chunk = [PropertyKey[], Record<PropertyKey, ModuleFactory>, ((require: WebpackRequire) => any)?];

export interface WebpackRequire {
  /** Load a module by id and return its exports. */
  (id: PropertyKey): Exports;
  /** Every registered module factory. */
  m: Record<PropertyKey, ModuleFactory>;
  /** Base URL chunks are resolved against. */
  p: string;
  [key: string]: any;
}
