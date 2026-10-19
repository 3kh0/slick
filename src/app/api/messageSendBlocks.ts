// Block Kit counterpart of messageSend.tsx. Slack builds the blocks from the
// composer's Delta after the Delta transforms have run, so anything that needs
// the final blocks patches the thunks every send, edit and schedule goes through.

import type { Block } from '../slack/blocks.ts';
import type { ReduxAPI } from '../slack/redux.ts';
import { registrationLabel } from './registrationLabel.ts';

type Redux = Pick<ReduxAPI, 'patchThunk' | 'getThunkCreator' | 'waitForThunkCreator'>;
type Dispatch = (action: unknown) => any;

/**
 * Return new blocks rather than editing them in place. Must be idempotent: one
 * message can pass through more than once, and a resend or a rescheduled draft
 * passes its own output back in.
 */
export type BlocksTransform = (blocks: Block[]) => Block[];

type RegisteredTransform = { transform: BlocksTransform; label: string };

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

const FORMAT_TIMEOUT_MS = 5_000;

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

const isBlock = (value: unknown): value is Block =>
  !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Block).type === 'string';

function linkUrls(blocks: Block[]): string[] {
  const urls: string[] = [];
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'link' && typeof node.url === 'string') urls.push(node.url);
    if (Array.isArray(node.elements)) for (const element of node.elements) visit(element);
  };
  for (const block of blocks) if (block.type === 'rich_text') visit(block);
  return urls;
}

/** Slack asks the server to unfurl the links the composer saw, so the list follows rewritten links. */
function remapUnfurls(unfurl: unknown, before: Block[], after: Block[]): unknown {
  const from = linkUrls(before);
  const to = linkUrls(after);
  if (from.length !== to.length) return unfurl;
  const renamed = new Map<string, string>();
  from.forEach((url, index) => {
    if (url !== to[index]) renamed.set(url, to[index]);
  });
  if (!renamed.size) return unfurl;
  const list = parseArray(unfurl);
  if (!list) return unfurl;
  const next = list.map((entry: any) =>
    typeof entry?.url === 'string' && renamed.has(entry.url) ? { ...entry, url: renamed.get(entry.url) } : entry,
  );
  return typeof unfurl === 'string' ? JSON.stringify(next) : next;
}

/** The markdown composer sends only text; its preview passes blocks as well. */
const markdownOnly = (args: any): string | undefined =>
  typeof args?.markdown_text === 'string' && args.markdown_text && !parseArray(args.blocks)
    ? args.markdown_text
    : undefined;

export function setupMessageSendBlocks(redux: Redux) {
  const transforms = new Set<RegisteredTransform>();

  function transformBlocks(blocks: Block[]): Block[] {
    let result = blocks;
    for (const { transform, label } of transforms) {
      try {
        const next = transform(result);
        if (Array.isArray(next) && next.every(isBlock)) {
          result = next;
        } else {
          console.error(`[slick] message blocks transform ${label} returned invalid blocks; ignoring it`);
        }
      } catch (error) {
        console.error(`[slick] message blocks transform ${label} failed; ignoring it:`, error);
      }
    }
    return result;
  }

  /** `args` carrying `blocks` after the transforms, or undefined if they changed nothing. */
  function transformArgs(args: any, blocks: Block[]): any {
    const after = transformBlocks(blocks);
    if (after === blocks) return undefined;
    const changed = { ...args, blocks: after };
    if (args.unfurl) changed.unfurl = remapUnfurls(args.unfurl, blocks, after);
    // The API refuses markdown_text next to blocks.
    delete changed.markdown_text;
    return changed;
  }

  /** The markdown composer's text as blocks, from the API call its preview uses. Bounded: a send waits on it. */
  async function markdownToBlocks(dispatch: Dispatch, markdown: string): Promise<Block[] | undefined> {
    try {
      const format =
        redux.getThunkCreator('blocksFormatFetcher') ??
        (await Promise.race([
          redux.waitForThunkCreator('blocksFormatFetcher'),
          new Promise<undefined>((resolve) => setTimeout(resolve, FORMAT_TIMEOUT_MS)),
        ]));
      if (!format) return undefined;
      const response = await dispatch(
        format({
          blocks: JSON.stringify([{ type: 'markdown', text: markdown }]),
          reason: 'slick-markdown-send',
          abortSignal: AbortSignal.timeout(FORMAT_TIMEOUT_MS),
        }),
      );
      const blocks = parseArray(response?.blocks);
      return blocks?.every(isBlock) ? blocks : undefined;
    } catch (error) {
      console.warn('[slick] could not convert markdown for message blocks transforms:', error);
      return undefined;
    }
  }

  // Sends, thread replies and resends: the blocks for both the pending message and the API payload.
  redux.patchThunk('sendMessage', (original) => (args: any, ...rest: any[]) => {
    if (!transforms.size) return original(args, ...rest);
    const markdown = markdownOnly(args);
    if (markdown) {
      return async (dispatch: Dispatch) => {
        const blocks = await markdownToBlocks(dispatch, markdown);
        return dispatch(original((blocks && transformArgs(args, blocks)) ?? args, ...rest));
      };
    }
    if (!Array.isArray(args?.blocks)) return original(args, ...rest);
    return original(transformArgs(args, args.blocks) ?? args, ...rest);
  });

  // The optimistic edit is drawn from what the thunk dispatches synchronously,
  // before chat.update goes out.
  redux.patchThunk('saveMessageEdit', (original) => (...args: any[]) => {
    const thunk = original(...args);
    if (typeof thunk !== 'function') return thunk;
    return (dispatch: Dispatch, ...rest: any[]) => {
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
    const blocks = parseArray(args.blocks);
    if (!blocks?.every(isBlock)) return options;
    const changed = transformArgs(args, blocks);
    if (!changed) return options;
    if (typeof args.blocks === 'string') changed.blocks = JSON.stringify(changed.blocks);
    return { ...options, args: changed };
  }

  // The rest at the wire: edits, scheduled drafts, file shares, forwards.
  for (const name of ['apiCall', 'apiCallExpedited']) {
    redux.patchThunk(name, (original) => (options: any, ...rest: any[]) => {
      const markdown = options?.method === 'chat.update' ? markdownOnly(options.args) : undefined;
      if (!transforms.size || !markdown) return original(transformApiCall(options), ...rest);
      // An edit from the markdown composer.
      return async (dispatch: Dispatch) => {
        const blocks = await markdownToBlocks(dispatch, markdown);
        const changed = blocks && transformArgs(options.args, blocks);
        if (!changed) return dispatch(original(options, ...rest));
        const args = { ...changed, blocks: JSON.stringify(changed.blocks) };
        return dispatch(original({ ...options, args }, ...rest));
      };
    });
  }

  /** Register a transform run over the Block Kit of every message sent, edited or scheduled. */
  return function onMessageSendBlocks(transform: BlocksTransform): () => void {
    const registered = { transform, label: registrationLabel(transform) };
    transforms.add(registered);
    return () => {
      transforms.delete(registered);
    };
  };
}
