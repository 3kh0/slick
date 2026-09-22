import { SlickPlugin, type Delta } from '$slick';
import { transformOps } from './markdown.ts';
import * as meta from './meta.ts';

const LIVE = ['bold', 'italic', 'strike', 'code', 'links'] as const;
type DeltaConstructor = new (ops?: unknown[]) => Delta;

export default class NotShitMarkdown extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = LIVE;

  start() {
    this.api.onMessageSendDelta((delta) => {
      // The inline parser has no lossless fenced-block representation, so a
      // fence it touches comes back as inline code with the delimiters eaten
      // -- it corrupts the code the user was quoting. Ops already carrying a
      // code attribute are Slack's own block and transformOps passes them
      // through; a fence typed as plain text is the dangerous case, so leave
      // the whole message alone. The text is joined first because Quill splits
      // ops at formatting boundaries and a fence can straddle two of them.
      const text = delta.ops.map((op) => ('insert' in op && typeof op.insert === 'string' ? op.insert : '')).join('');
      if (text.includes('```')) return delta;
      const ops = transformOps(delta.ops, this.config);
      if (ops === delta.ops) return delta;
      // The send hook is synchronous, so the async blocks.makeDelta helper cannot
      // be used here. The incoming object is Slack's real Quill Delta and its
      // constructor is the same one Slack expects on the way back out.
      const DeltaClass = delta.constructor as DeltaConstructor;
      return new DeltaClass(ops);
    });
  }
}
