// Only the parts of Slack's webpack/rspack runtime that webpack.ts touches.

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
  (id: PropertyKey): Exports;
  m: Record<PropertyKey, ModuleFactory>;
  /** Base URL chunks are resolved against. */
  p: string;
  [key: string]: any;
}
