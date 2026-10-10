import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import { dictionaryLookup, type SyllableLookup } from './haiku.ts';

const PACKED = 'slick:gzip:1:';

/** Build-time only; deterministic so identical source produces identical bundles. */
export function packDictionary(text: string): string {
  const bytes = gzipSync(strToU8(text), { mtime: 0 });
  // Avoid spreading the whole dictionary into a function's argument list.
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return PACKED + btoa(binary);
}

/** The optional plugin pays for decompression only on its first lookup. */
export function createDictionaryLookup(source: string): SyllableLookup {
  let text: string | undefined;
  return (word) => {
    if (text === undefined) {
      text = source.startsWith(PACKED)
        ? strFromU8(gunzipSync(Uint8Array.from(atob(source.slice(PACKED.length)), (char) => char.charCodeAt(0))))
        : source;
    }
    return dictionaryLookup(text, word);
  };
}
