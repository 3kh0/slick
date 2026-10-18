// Block Kit counterpart of messageSend.tsx. Slack builds the blocks from the
// composer's Delta after the Delta transforms have run, so anything that needs
// the final blocks patches the thunks every send, edit and schedule goes through.

import type { Block } from '../slack/blocks.ts';

type PatchThunk = (name: string, wrap: (original: (...args: any[]) => any) => (...args: any[]) => any) => () => void;

/** Must be idempotent: a resend or a rescheduled draft passes its own output back in. */
export type BlocksTransform = (blocks: Block[]) => Block[];

// API calls that carry the message's blocks outside sendMessage and saveMessageEdit.
const API_METHODS = new Set([
  'chat.postMessage',
  'chat.update',
  'chat.shareMessage',
  'files.share',
  'files.uploadExternal',
  'drafts.create',
  'drafts.update',
]);

function parseArray(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function setupMessageSendBlocks(patchThunk: PatchThunk) {
  const transforms = new Set<BlocksTransform>();

  function transformBlocks(blocks: Block[]): Block[] {
    let result = blocks;
    for (const transform of transforms) {
      try {
        const next = transform(result);
        if (Array.isArray(next)) result = next;
      } catch (error) {
        console.error('[slick] message blocks transform failed; ignoring it:', error);
      }
    }
    return result;
  }

  // Sends, thread replies and resends.
  patchThunk('sendMessage', (original) => (args: any, ...rest: any[]) => {
    if (!transforms.size || !Array.isArray(args?.blocks)) return original(args, ...rest);
    const blocks = transformBlocks(args.blocks);
    return original(blocks === args.blocks ? args : { ...args, blocks }, ...rest);
  });

  // The optimistic edit is drawn from what the thunk dispatches synchronously,
  // before chat.update goes out.
  patchThunk('saveMessageEdit', (original) => (...args: any[]) => {
    const thunk = original(...args);
    if (typeof thunk !== 'function') return thunk;
    return (dispatch: (action: any) => any, ...rest: any[]) => {
      let synchronous = true;
      const transformingDispatch = (action: any) => {
        const payload = action?.payload;
        if (
          synchronous &&
          transforms.size &&
          typeof action === 'object' &&
          Array.isArray(payload?.blocks) &&
          typeof payload.ts === 'string' &&
          typeof payload.channelId === 'string'
        ) {
          const blocks = transformBlocks(payload.blocks);
          if (blocks !== payload.blocks) action = { ...action, payload: { ...payload, blocks } };
        }
        return dispatch(action);
      };
      try {
        return thunk(transformingDispatch, ...rest);
      } finally {
        synchronous = false;
      }
    };
  });

  function transformApiCall(options: any): any {
    const method = options?.method;
    const args = options?.args;
    if (!API_METHODS.has(method) || !args || !transforms.size) return options;
    // Scheduled messages are drafts, and only those have a date.
    if (method.startsWith('drafts.') && !args.date_scheduled) return options;
    const blocks = parseArray(args.blocks) as Block[] | undefined;
    if (!blocks) return options;
    const next = transformBlocks(blocks);
    if (next === blocks) return options;
    return { ...options, args: { ...args, blocks: typeof args.blocks === 'string' ? JSON.stringify(next) : next } };
  }

  // The rest at the wire: edits, scheduled drafts, file shares, forwards.
  for (const name of ['apiCall', 'apiCallExpedited']) {
    patchThunk(
      name,
      (original) =>
        (options: any, ...rest: any[]) =>
          original(transformApiCall(options), ...rest),
    );
  }

  /** Register a transform run over the Block Kit of every message sent, edited or scheduled. */
  return function onMessageSendBlocks(transform: BlocksTransform): () => void {
    transforms.add(transform);
    return () => {
      transforms.delete(transform);
    };
  };
}
