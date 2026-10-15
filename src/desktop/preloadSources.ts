import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

type Source = { file: string; text: string; references: number };

/** Share unchanged preload text while keeping each live window's original version. */
export function createPreloadSources(read: (file: string) => string = (file) => readFileSync(file, 'utf8')) {
  const tokens = new Map<string, Source>();
  const current = new Map<string, Source>();

  return {
    register(file: string): string {
      // Read on every new window: development rebuilds and replaced Slack files
      // must take effect even when an older window still uses its prior source.
      const text = read(file);
      if (!text.trim()) throw new Error('preload is empty');
      const token = randomUUID();
      let source = current.get(file);
      if (!source || source.text !== text) {
        source = { file, text, references: 0 };
        current.set(file, source);
      }
      source.references++;
      tokens.set(token, source);
      return token;
    },
    get(token: string): string | null {
      return tokens.get(token)?.text ?? null;
    },
    release(token: string): void {
      const source = tokens.get(token);
      if (!source) return;
      tokens.delete(token);
      if (--source.references === 0 && current.get(source.file) === source) current.delete(source.file);
    },
  };
}
