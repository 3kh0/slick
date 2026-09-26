declare module 'slick:plugins' {
  const plugins: Record<string, import('./shared/Plugin.ts').SlickPluginConstructor>;
  export default plugins;
}

declare module 'slick:background-plugins' {
  const plugins: import('./extension/mainHost.ts').BackgroundPlugin[];
  export default plugins;
}

declare module 'slick:options-data' {
  export const plugins: { id: string; name: string; description: string }[];
  export const themes: { id: string; name: string; background: string | null; accent: string | null }[];
  export const version: string;
}

// Asset imports are inlined as data URIs by scripts/build/app.ts.
declare module '*.gif' {
  const url: string;
  export default url;
}
