// Build-time constants substituted by esbuild's `define` (scripts/build/*.ts).
// Declared once here so files that are scripts rather than modules (the app
// entry, the preload) do not each redeclare them into the global scope.

declare const __SLICK_VERSION__: string;
declare const __SLICK_BUILD__: number;
