declare module 'slick:plugins' {
  const plugins: Record<string, import('./shared/Plugin.ts').SlickPluginConstructor>;
  export default plugins;
}

// Asset imports are inlined as data URIs by scripts/build/app.ts.
declare module '*.gif' {
  const url: string;
  export default url;
}
