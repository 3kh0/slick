// Asset imports are inlined as data URIs by the plugin bundler
// (scripts/lib/plugin.ts).
declare module '*.gif' {
  const url: string;
  export default url;
}
