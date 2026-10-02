// Build-time constants from esbuild's `define` (scripts/build/*.ts), declared
// once so non-module scripts don't each redeclare them.

declare const __SLICK_VERSION__: string;
declare const __SLICK_BUILD__: number;
declare const __SLICK_THEMES__: Record<string, import('./app/theme.ts').ThemeJson>;

// Desktop dialogs bundle local fonts as data URLs.
declare module '*.woff2' {
  const url: string;
  export default url;
}
