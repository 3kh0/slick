export type BlobChange = [key: string, value: string | null];
export const BATCH_KEYS = 128;
export const BATCH_TEXT = 256 * 1024;

/** Bound the JSON envelope, including escaping, to the extension relay limit. */
export function* blobBatches(changes: Iterable<BlobChange>): Generator<BlobChange[]> {
  let batch: BlobChange[] = [];
  let size = 2;
  for (const change of changes) {
    const length = JSON.stringify(change).length;
    if (batch.length && (batch.length >= BATCH_KEYS || size + length + 1 > BATCH_TEXT)) {
      yield batch;
      batch = [];
      size = 2;
    }
    batch.push(change);
    size += length + 1;
  }
  if (batch.length) yield batch;
}

export function parseBlobBatch(text: string): BlobChange[] | null {
  if (text.length > BATCH_TEXT) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value) || !value.length || value.length > BATCH_KEYS) return null;
    if (
      !value.every(
        (row) =>
          Array.isArray(row) &&
          row.length === 2 &&
          typeof row[0] === 'string' &&
          row[0].length > 0 &&
          row[0].length <= 128 &&
          (row[1] === null || typeof row[1] === 'string'),
      )
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
