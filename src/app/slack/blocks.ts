// Block Kit conversion via Slack's own converters, so mention, link and emoji
// resolution match what Slack's composer sends. They need the store's state.

import type { Delta } from '../../shared/delta.ts';
import { getStore } from './redux.ts';
import { waitForExport } from './webpack.ts';

/** One Block Kit block. Slack's composer produces `rich_text` blocks. */
export type Block = Record<string, unknown>;

/** Options Slack's converter accepts; all default off inside Slack itself. */
export type FromDeltaOptions = {
  convertEmpty?: boolean;
  trimEndingWhitespace?: boolean;
  trimStartingWhitespace?: boolean;
  expandTruncatedLinks?: boolean;
  useExpandedRichText?: boolean;
  splitSectionsOnNewlines?: boolean;
  supportNonRichTextBlocks?: boolean;
  useRichTextHeadersAndDividers?: boolean;
};

type ConvertDeltaToBlocks = (arg: {
  delta: Delta;
  options?: FromDeltaOptions;
  state: unknown;
}) => { blocks?: Block[] } | undefined;
type ConvertBlocksToText = (state: unknown, blocks: Block[]) => string;
type DeltaConstructor = new (ops?: unknown[]) => Delta;

const named = (name: string) => (exp: any) => typeof exp === 'function' && (exp.displayName || exp.name) === name;

/** Quill's Delta class, identified by its prototype rather than by name. */
const isDelta = (exp: any): boolean => {
  if (typeof exp !== 'function' || !exp.prototype) return false;
  const proto = exp.prototype;
  return (
    typeof proto.insert === 'function' &&
    typeof proto.retain === 'function' &&
    typeof proto.concat === 'function' &&
    typeof proto.compose === 'function'
  );
};

export const blocksReady = (async () => {
  const deltaToBlocks = waitForExport<ConvertDeltaToBlocks>(named('convertDeltaToBlocks'));
  const blocksToPlainText = waitForExport<ConvertBlocksToText>(named('convertBlocksToPlainText'));
  const blocksToMarkdown = waitForExport<ConvertBlocksToText>(named('convertBlocksToMarkdown'));
  const deltaClass = waitForExport<DeltaConstructor>(isDelta);

  function state(): unknown {
    const store = getStore();
    if (!store) throw new Error('[slick] Block Kit: redux store unavailable');
    return store.getState();
  }

  /** Build a real Delta from raw ops, e.g. the `ops` array on a stored draft. */
  async function makeDelta(ops: unknown[]): Promise<Delta> {
    const DeltaClass = await deltaClass;
    return new DeltaClass(ops);
  }

  /** Convert composer content (a Delta or a draft's raw ops) to Block Kit. */
  async function fromDelta(content: Delta | unknown[], options?: FromDeltaOptions): Promise<Block[]> {
    const convert = await deltaToBlocks;
    const delta = Array.isArray(content) ? await makeDelta(content) : content;
    return convert({ delta, options, state: state() })?.blocks ?? [];
  }

  /** Flatten blocks to plain text, for a notification or search fallback. */
  async function toPlainText(blocks: Block[]): Promise<string> {
    return (await blocksToPlainText)(state(), blocks);
  }

  /** Render blocks as Markdown, with mentions and links resolved to names. */
  async function toMarkdown(blocks: Block[]): Promise<string> {
    return (await blocksToMarkdown)(state(), blocks);
  }

  return { makeDelta, fromDelta, toPlainText, toMarkdown };
})();

export type BlocksAPI = Awaited<typeof blocksReady>;
