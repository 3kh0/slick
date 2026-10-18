// Lets a plugin hold a message back in the composer. Checks run on the blocks
// Slack would build from the Delta, before the Delta transforms.

import type { Delta } from '../../shared/delta.ts';
import { blocksReady, type Block } from '../slack/blocks.ts';
import type { ComponentReplacer } from '../slack/react.tsx';

type PatchComponent = <P>(name: string, replacer: ComponentReplacer<P>) => () => void;

/** Which composer a message is being sent from. */
export type SendCheckContext = { channelId: string; threadTs?: string };

/** Return false to keep the message in the composer. May be async, e.g. to ask for confirmation. */
export type SendCheck = (blocks: Block[], context: SendCheckContext) => boolean | Promise<boolean>;

type SendOptions = { delta?: Delta; channelId?: string; replyToTs?: string };
type SendProps = {
  channelId?: string;
  threadTs?: string;
  prepareAndSendMessage?: (options: SendOptions) => Promise<unknown>;
};

export function setupSendChecks(patchComponent: PatchComponent) {
  const checks = new Set<SendCheck>();
  // One send can pass through both composers' patches, so each Delta is decided once.
  const decisions = new WeakMap<object, Promise<boolean>>();

  async function passes(delta: Delta, context: SendCheckContext): Promise<boolean> {
    let blocks: Block[];
    try {
      blocks = await (await blocksReady).fromDelta(delta);
    } catch (error) {
      console.error('[slick] send checks could not read the message:', error);
      return true;
    }
    for (const check of checks) {
      try {
        if ((await check(blocks, context)) === false) return false;
      } catch (error) {
        console.error('[slick] send check failed; ignoring it:', error);
      }
    }
    return true;
  }

  // Channel composers send through MessagePaneInput, thread composers through InputContainer.
  for (const name of ['MessagePaneInput', 'InputContainer']) {
    patchComponent<SendProps>(name, (Original) => (props) => {
      const send = props.prepareAndSendMessage;
      const checkedSend = React.useCallback(
        async (options: SendOptions) => {
          const { delta } = options;
          const channelId = options.channelId || props.channelId;
          if (!send || !checks.size || !delta || !channelId) return send?.(options);

          let decision = decisions.get(delta);
          if (!decision) {
            decision = passes(delta, { channelId, threadTs: options.replyToTs ?? props.threadTs });
            decisions.set(delta, decision);
          }
          if (!(await decision)) {
            decisions.delete(delta);
            // A rejected send puts the message back in the composer, as Slack's own warnings do.
            throw new Error('[slick] a send check held this message back');
          }
          return send(options);
        },
        [send, props.channelId, props.threadTs],
      );
      if (!send) return <Original {...props} />;
      return <Original {...props} prepareAndSendMessage={checkedSend} />;
    });
  }

  /** Register a check run before every message sent from a composer. */
  return function addSendCheck(check: SendCheck): () => void {
    checks.add(check);
    return () => {
      checks.delete(check);
    };
  };
}
