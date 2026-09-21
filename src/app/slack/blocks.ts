// Block Kit conversion, done by Slack's own converters.
//
// Re-implementing Delta -> blocks would mean re-implementing mention, link and
// emoji resolution, and any drift shows up as a message that renders wrong for
// everyone else. Slack's converter needs the store passed in, which is the
// only reason this is not a pure function.

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

  /**
   * Convert composer content to Block Kit. Accepts a Delta or the raw ops
   * array drafts are stored as. Mentions, links and formatting are resolved by
   * Slack, so the result matches what its own composer would have sent.
   */
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
