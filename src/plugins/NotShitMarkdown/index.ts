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
