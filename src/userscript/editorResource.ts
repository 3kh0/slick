export async function verifyEditorResource(source: string | undefined, expectedHash: string): Promise<string> {
  if (!source) throw new Error('Monaco resource is missing');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== expectedHash) throw new Error('Monaco resource does not match this Slick build');
  return source;
}
