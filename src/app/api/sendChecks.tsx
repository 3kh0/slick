// Lets a plugin hold a message back in the composer. Checks run on the blocks
// Slack would build from what the user wrote, before the Delta transforms.

import type { Delta } from '../../shared/delta.ts';
import { fromDeltaNow, type Block } from '../slack/blocks.ts';
import type { ComponentReplacer } from '../slack/react.tsx';
import { getExport } from '../slack/webpack.ts';
import { composedDeltas } from './messageSend.tsx';
import { registrationLabel } from './registrationLabel.ts';

type PatchComponent = <P>(name: string, replacer: ComponentReplacer<P>) => () => void;

/** Which composer a message is being sent from. */
export type SendCheckContext = { channelId: string; threadTs?: string };

/**
 * Return false to keep the message in the composer. May be async, e.g. to ask
 * for confirmation: the message waits in the composer and is sent once the
 * check passes, unless the user has changed it by then.
 */
export type SendCheck = (blocks: Block[], context: SendCheckContext) => boolean | Promise<boolean>;

type RegisteredCheck = { check: SendCheck; label: string };
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
type Hold = {
  /** Stops holding the message; true if it had just put it back. */
  drop: () => boolean;
  /** Once the checks pass, sends the message if it's still the composer's or about to be. */
  release: (send: () => void) => void;
};

const HELD = '[slick] a send check held this message back';
/** How long a held message is put back whenever Slack wipes it. */
const HOLD_MS = 1000;

function ignoreFailure(label: string, error: unknown) {
  console.error(`[slick] send check ${label} failed; ignoring it:`, error);
  return true;
}

function runCheck({ check, label }: RegisteredCheck, blocks: Block[], context: SendCheckContext) {
  try {
    const result: unknown = check(blocks, context);
    if (typeof (result as PromiseLike<unknown> | undefined)?.then !== 'function') return result !== false;
    return Promise.resolve(result).then(
      (passed) => passed !== false,
      (error) => ignoreFailure(label, error),
    );
  } catch (error) {
    return ignoreFailure(label, error);
  }
}

/** Stays synchronous until a check returns a promise. */
function runChecks(queue: RegisteredCheck[], blocks: Block[], context: SendCheckContext): boolean | Promise<boolean> {
  while (queue.length) {
    const passed = runCheck(queue.shift()!, blocks, context);
    if (passed instanceof Promise) return passed.then((ok) => ok && runChecks(queue, blocks, context));
    if (!passed) return false;
  }
  return true;
}

let getInputProxy: GetInputProxy | undefined;

function inputFor(options: SendOptions, context: SendCheckContext): InputProxy | undefined {
  getInputProxy ??= getExport<GetInputProxy>((exp: any) => typeof exp === 'function' && exp.name === 'getInputProxy');
  try {
    return getInputProxy?.({ viewContext: options.viewContext, ...context });
  } catch {
    return undefined;
  }
}

// A later send from a composer supersedes the message it was holding, so a
// message sent again while held can't go out twice.
const holds = new WeakMap<Quill, Hold>();

/**
 * Slack puts a rejected message back a moment after the send. When the send
 * deleted a draft, it also clears the composer a frame later and can wipe the
 * message it just put back, so restore it until the user types.
 */
function holdInComposer(input: InputProxy, quill: Quill, held: Delta): Hold {
  let active = true;
  let restoring = true;
  let restoredNow = false;
  let putting = false;
  let pending: (() => void) | undefined;

  const holding = () => JSON.stringify(input.getContents?.()?.contents) === JSON.stringify(held.ops);
  const stopRestoring = () => {
    restoring = false;
    clearTimeout(timer);
    quill.off('text-change', onChange);
  };
  const drop = () => {
    const undo = restoring && restoredNow;
    active = false;
    pending = undefined;
    stopRestoring();
    if (holds.get(quill) === hold) holds.delete(quill);
    return undo;
  };
  const onChange: TextChange = (_change, _old, source) => {
    if (source === 'user') {
      drop();
    } else if (input.isEmpty()) {
      // A message that reads as empty would put itself back forever.
      if (putting) return;
      restoredNow = true;
      queueMicrotask(() => (restoredNow = false));
      putting = true;
      try {
        input.setContents({ contents: held.ops });
      } finally {
        putting = false;
      }
    } else if (pending && holding()) {
      pending();
    }
  };
  const timer = setTimeout(() => {
    if (!pending) stopRestoring();
    // Empty means Slack never put it back, so there's nothing to take out first.
    else if (holding() || input.isEmpty()) pending();
    else drop();
  }, HOLD_MS);
  quill.on('text-change', onChange);

  const hold: Hold = {
    drop,
    release(send) {
      if (!active) return;
      const sendNow = () => {
        drop();
        input.clear();
        send();
      };
      if (holding()) sendNow();
      // The checks passed before Slack put the message back: send once it has.
      else if (restoring && input.isEmpty()) pending = sendNow;
      else drop();
    },
  };
  holds.set(quill, hold);
  return hold;
}

export function setupSendChecks(patchComponent: PatchComponent) {
  const checks = new Set<RegisteredCheck>();
  // Sends already decided: one can pass through both composers' patches, and a
  // held message goes out through the patch that held it.
  const decided = new WeakSet<Delta>();

  /** Sends a message held in its composer, the way Slack's own warnings resend after "Send anyway". */
  async function sendHeld(send: Send, options: SendOptions, input: InputProxy, held: Delta) {
    decided.add(held);
    try {
      await send(options);
    } catch (error) {
      console.error('[slick] held message was not sent:', error);
      if (input.isEmpty()) input.setContents({ contents: held.ops });
    }
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

          const composed = composedDeltas.get(delta) ?? delta;
          if (decided.has(composed)) return send(options);

          const context = { channelId, threadTs: options.replyToTs ?? props.threadTs };
          const input = inputFor(options, context);
          const quill = input?.getContainer?.()?.__quill;
          // Slack empties the composer before it sends, which a hold still
          // running from the last send takes for a wipe and undoes.
          if (input && quill && holds.get(quill)?.drop()) input.clear();

          let blocks: Block[];
          try {
            blocks = fromDeltaNow(composed);
          } catch (error) {
            console.error('[slick] send checks could not read the message:', error);
            return send(options);
          }
          const passed = runChecks([...checks], blocks, context);
          if (passed === true) {
            decided.add(composed);
            return send(options);
          }
          if (!input || !quill) {
            // Without the composer there's nowhere to hold the message, so the send waits instead.
            if (passed && (await passed)) {
              decided.add(composed);
              return send(options);
            }
            throw new Error(HELD);
          }
          // Slack has already emptied the composer, and puts a rejected message
          // back only while it's still empty, so a pending check can't hold the send open.
          const hold = holdInComposer(input, quill, composed);
          if (passed) {
            void passed.then((ok) => {
              if (ok) hold.release(() => void sendHeld(send, options, input, composed));
            });
          }
          throw new Error(HELD);
        },
        [send, props.channelId, props.threadTs],
      );
      if (!send) return <Original {...props} />;
      return <Original {...props} prepareAndSendMessage={checkedSend} />;
    });
  }

  /** Register a check run before every message sent from a composer. */
  return function addSendCheck(check: SendCheck): () => void {
    const registered = { check, label: registrationLabel(check) };
    checks.add(registered);
    return () => {
      checks.delete(registered);
    };
  };
}
