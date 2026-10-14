import { gunzipSync } from 'fflate';

// The build compresses the offline dictionary. Source/test bundles may still
// provide plain text. Neither path needs a fetch or dynamic code evaluation.
export const COMPRESSED_DICTIONARY = 'gzip-base64:';

export async function decodeDictionary(source: string): Promise<string> {
  if (!source.startsWith(COMPRESSED_DICTIONARY)) return source;
  const bytes = Uint8Array.from(atob(source.slice(COMPRESSED_DICTIONARY.length)), (char) => char.charCodeAt(0));
  if (typeof DecompressionStream === 'function') {
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }
  // Older userscript hosts can still use the plugin without native gzip.
  return new TextDecoder().decode(gunzipSync(bytes));
}

/** Decode only on use, once per plugin instance, including concurrent sends. */
export function dictionaryLoader(source: string): () => Promise<string> {
  let pending: Promise<string> | undefined;
  return () => (pending ??= decodeDictionary(source));
}
