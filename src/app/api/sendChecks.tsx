// Lets a plugin hold a message back in the composer. Checks run on the blocks
// Slack would build from what the user wrote, before the Delta transforms.

import type { Delta } from '../../shared/delta.ts';
import { fromDeltaNow, type Block } from '../slack/blocks.ts';
import type { ComponentReplacer } from '../slack/react.tsx';
import { getExport } from '../slack/webpack.ts';
import { composedDeltas } from './messageSend.tsx';

type PatchComponent = <P>(name: string, replacer: ComponentReplacer<P>) => () => void;

/** Which composer a message is being sent from. */
export type SendCheckContext = { channelId: string; threadTs?: string };

/**
 * Return false to keep the message in the composer. May be async, e.g. to ask
 * for confirmation: the message waits in the composer and is sent once the
 * check passes, unless the user has changed it by then.
 */
export type SendCheck = (blocks: Block[], context: SendCheckContext) => boolean | Promise<boolean>;

type SendOptions = { delta?: Delta; channelId?: string; replyToTs?: string; viewContext?: string };
type Send = (options: SendOptions) => Promise<unknown>;
type SendProps = { channelId?: string; threadTs?: string; prepareAndSendMessage?: Send };
type TextChange = (change: unknown, old: unknown, source: string) => void;
type Quill = {
  on: (event: 'text-change', handler: TextChange) => void;
  off: (event: 'text-change', handler: TextChange) => void;
};
type InputProxy = {
  clear: () => void;
  isEmpty: () => boolean;
  getContents?: () => { contents?: unknown } | undefined;
  setContents: (contents: { contents: unknown[] }) => void;
  getContainer?: () => (Element & { __quill?: Quill }) | null | undefined;
};
type GetInputProxy = (key: { viewContext?: string; channelId: string; threadTs?: string }) => InputProxy | undefined;

function ignoreFailure(error: unknown) {
  console.error('[slick] send check failed; ignoring it:', error);
  return true;
}

function runCheck(check: SendCheck, blocks: Block[], context: SendCheckContext): boolean | Promise<boolean> {
  try {
    const result: unknown = check(blocks, context);
    if (typeof (result as PromiseLike<unknown> | undefined)?.then !== 'function') return result !== false;
    return Promise.resolve(result).then((passed) => passed !== false, ignoreFailure);
  } catch (error) {
    return ignoreFailure(error);
  }
}

/** Stays synchronous until a check returns a promise. */
function runChecks(queue: SendCheck[], blocks: Block[], context: SendCheckContext): boolean | Promise<boolean> {
  while (queue.length) {
    const passed = runCheck(queue.shift()!, blocks, context);
    if (passed instanceof Promise) return passed.then((ok) => ok && runChecks(queue, blocks, context));
    if (!passed) return false;
  }
  return true;
}

function inputFor(options: SendOptions, context: SendCheckContext): InputProxy | undefined {
  const getInputProxy = getExport<GetInputProxy>(
    (exp: any) => typeof exp === 'function' && exp.name === 'getInputProxy',
  );
  return getInputProxy?.({ viewContext: options.viewContext, ...context });
}

/**
 * When the send deleted a draft, Slack clears the composer a frame later and
 * can wipe the message it just put back, so restore it until the user types.
 */
function keepInComposer(input: InputProxy | undefined, held: Delta): () => void {
  const quill = input?.getContainer?.()?.__quill;
  if (!input || !quill) return () => {};
  const release = () => {
    clearTimeout(timer);
    quill.off('text-change', onChange);
  };
  const onChange: TextChange = (_change, _old, source) => {
    if (source === 'user') release();
    else if (input.isEmpty()) input.setContents({ contents: held.ops });
  };
  const timer = setTimeout(release, 1000);
  quill.on('text-change', onChange);
  return release;
}

/** Sends a message held in its composer, the way Slack's own warnings resend after "Send anyway". */
async function sendHeld(send: Send, options: SendOptions, held: Delta, context: SendCheckContext) {
  const input = inputFor(options, context);
  if (!input || JSON.stringify(input.getContents?.()?.contents) !== JSON.stringify(held.ops)) return;
  input.clear();
  try {
    await send(options);
  } catch (error) {
    console.error('[slick] held message was not sent:', error);
    if (input.isEmpty()) input.setContents({ contents: held.ops });
  }
}

export function setupSendChecks(patchComponent: PatchComponent) {
  const checks = new Set<SendCheck>();

  // Channel composers send through MessagePaneInput, thread composers through InputContainer.
  for (const name of ['MessagePaneInput', 'InputContainer']) {
    patchComponent<SendProps>(name, (Original) => (props) => {
      const send = props.prepareAndSendMessage;
      const checkedSend = React.useCallback(
        async (options: SendOptions) => {
          const { delta } = options;
          const channelId = options.channelId || props.channelId;
          if (!send || !checks.size || !delta || !channelId) return send?.(options);

          const composed = composedDeltas.get(delta) ?? delta;
          let blocks: Block[];
          try {
            blocks = fromDeltaNow(composed);
          } catch (error) {
            console.error('[slick] send checks could not read the message:', error);
            return send(options);
          }
          const context = { channelId, threadTs: options.replyToTs ?? props.threadTs };
          const passed = runChecks([...checks], blocks, context);
          if (passed === true) return send(options);
          // Slack has already emptied the composer, and puts a rejected message
          // back only while it's still empty, so a pending check can't hold the send open.
          const release = keepInComposer(inputFor(options, context), composed);
          if (passed) {
            void passed.then((ok) => {
              if (!ok) return;
              release();
              return sendHeld(send, options, composed, context);
            });
          }
          throw new Error('[slick] a send check held this message back');
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
