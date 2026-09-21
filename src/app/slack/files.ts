// Uploading through Slack's own uploader, so the file arrives attributed to
// the signed-in user and with the metadata Slack expects.

import { dispatchThunk } from './redux.ts';

type PendingUpload = { uploadPromise?: Promise<{ fileIds?: string[] }> };

/**
 * Upload as the current user and resolve with the new file id. Slack reads
 * fields like `subtype` off the File and writes `id` back onto it, so this
 * needs a real File rather than a Blob.
 */
export async function uploadFile(file: File): Promise<string> {
  const pending: PendingUpload = await dispatchThunk('addAndUploadPendingFile', { file, hideBanner: true });
  const fileId = (await pending?.uploadPromise)?.fileIds?.[0];
  if (!fileId) throw new Error('[slick] Slack rejected the upload');
  return fileId;
}

export const filesReady = (async () => ({ upload: uploadFile }))();

export type FilesAPI = Awaited<typeof filesReady>;
