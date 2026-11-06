// This database is extension-private and never uses the renderer blob service.
// The non-extractable AES key and ciphertext persist across worker restarts.
export interface AccountVault<T> {
  read(): Promise<T>;
  write(value: T): Promise<void>;
}

const result = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(new Error('Could not read the saved accounts')));
  });

export function encryptedAccountVault<T>(empty: () => T, factory?: IDBFactory): AccountVault<T> {
  let opening: Promise<IDBDatabase> | undefined;
  const open = () =>
    (opening ??= new Promise((resolve, reject) => {
      const request = (factory ?? indexedDB).open('slick-accounts', 1);
      request.addEventListener('upgradeneeded', () => request.result.createObjectStore('vault'));
      request.addEventListener('success', () => {
        request.result.addEventListener('versionchange', () => {
          request.result.close();
          opening = undefined;
        });
        resolve(request.result);
      });
      request.addEventListener('error', () => {
        opening = undefined;
        reject(new Error('Could not open the saved accounts'));
      });
    }));
  async function readRecord(name: string) {
    return result((await open()).transaction('vault').objectStore('vault').get(name));
  }
  async function writeRecord(name: string, value: unknown) {
    const tx = (await open()).transaction('vault', 'readwrite');
    const completed = new Promise<void>((resolve, reject) => {
      tx.addEventListener('complete', () => resolve());
      tx.addEventListener('abort', () => reject(new Error('Could not save the accounts')));
      tx.addEventListener('error', () => reject(new Error('Could not save the accounts')));
    });
    tx.objectStore('vault').put(value, name);
    await completed;
  }
  let keyReady: Promise<CryptoKey> | undefined;
  const key = () =>
    (keyReady ??= (async () => {
      const stored = await readRecord('key');
      if (stored) return stored as CryptoKey;
      const generated = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt',
      ]);
      await writeRecord('key', generated);
      return generated;
    })());
  return {
    async read() {
      const sealed = (await readRecord('state')) as { iv: Uint8Array; ciphertext: ArrayBuffer } | undefined;
      if (!sealed) return empty();
      try {
        const plaintext = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: sealed.iv as Uint8Array<ArrayBuffer> },
          await key(),
          sealed.ciphertext,
        );
        return JSON.parse(new TextDecoder().decode(plaintext)) as T;
      } catch {
        throw new Error(
          'Saved accounts could not be decrypted. Do not clear browser data; try restarting the browser.',
        );
      }
    },
    async write(value) {
      const plaintext = new TextEncoder().encode(JSON.stringify(value));
      if (plaintext.length > 5 * 1024 * 1024) throw new Error('Saved accounts quota exceeded');
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), plaintext);
      await writeRecord('state', { iv, ciphertext });
    },
  };
}
