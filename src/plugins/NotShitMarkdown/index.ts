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
      // The inline parser mangles a plain-text ``` fence into inline code, so
      // leave such messages alone (Slack's own code blocks carry a code
      // attribute and pass through). Join first: Quill splits ops at
      // formatting boundaries and a fence can straddle two.
      const text = delta.ops.map((op) => ('insert' in op && typeof op.insert === 'string' ? op.insert : '')).join('');
      if (text.includes('```')) return delta;
      const ops = transformOps(delta.ops, this.config);
      if (ops === delta.ops) return delta;
      // The send hook is synchronous, so async blocks.makeDelta is out; reuse
      // the incoming Delta's constructor, which is the one Slack expects.
      const DeltaClass = delta.constructor as DeltaConstructor;
      return new DeltaClass(ops);
    });
  }
}
