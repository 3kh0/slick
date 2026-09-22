import { dispatchThunk } from './redux.ts';

type PendingUpload = { uploadPromise?: Promise<{ fileIds?: string[] }> };

/**
 * Upload via Slack's own uploader; resolves with the file id. Needs a real
 * File: Slack reads `subtype` off it and writes `id` back.
 */
export async function uploadFile(file: File): Promise<string> {
  const pending: PendingUpload = await dispatchThunk('addAndUploadPendingFile', { file, hideBanner: true });
  const fileId = (await pending?.uploadPromise)?.fileIds?.[0];
  if (!fileId) throw new Error('[slick] Slack rejected the upload');
  return fileId;
}

export const filesReady = (async () => ({ upload: uploadFile }))();

export type FilesAPI = Awaited<typeof filesReady>;
