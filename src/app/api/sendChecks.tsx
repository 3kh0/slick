import { fromDeltaNow, type Block } from '../slack/blocks.ts';
import type { ComponentReplacer } from '../slack/react.tsx';
import { getExport } from '../slack/webpack.ts';
import { registrationLabel } from './registrationLabel.ts';

type PatchComponent = <P>(name: string, replacer: ComponentReplacer<P>) => () => void;

/** Which composer a message is being sent from. */
export type SendCheckContext = { channelId: string; threadTs?: string; targetWindow?: Window };

/** Return false to keep the message in the composer; async checks also cancel on user edits. */
export type SendCheck = (blocks: Block[], context: SendCheckContext) => boolean | Promise<boolean>;

type RegisteredCheck = { check: SendCheck; label: string };
type SendProps = {
  channelId?: string;
  threadTs?: string;
  viewContext?: string;
  sendMessage?: (...args: any[]) => unknown;
};
type TextChange = (change: unknown, old: unknown, source: string) => void;
type Quill = {
  on: (event: 'text-change', handler: TextChange) => void;
  off: (event: 'text-change', handler: TextChange) => void;
};
type InputProxy = {
  getContents?: () => { contents?: unknown[] } | undefined;
  getContainer?: () => (Element & { __quill?: Quill }) | null | undefined;
};
type GetInputProxy = (key: SendProps & { targetWindow: Window }) => InputProxy | undefined;
type WindowContext = { windowRef?: WeakRef<Window> };

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

function runChecks(queue: RegisteredCheck[], blocks: Block[], context: SendCheckContext): boolean | Promise<boolean> {
  while (queue.length) {
    const passed = runCheck(queue.shift()!, blocks, context);
    if (passed instanceof Promise) return passed.then((ok) => ok && runChecks(queue, blocks, context));
    if (!passed) return false;
  }
  return true;
}

let getInputProxy: GetInputProxy | undefined;

export function setupSendChecks(patchComponent: PatchComponent) {
  const checks = new Set<RegisteredCheck>();
  const pending = new WeakMap<Quill, () => void>();

  // MessageInput is shared by channels, threads and pop-outs, before Slack clears their drafts.
  patchComponent<SendProps>('MessageInput', (Original) => {
    const WindowContext =
      getExport<React.Context<WindowContext | undefined>>((exp: any) => exp?.displayName === 'WindowContext') ??
      React.createContext<WindowContext | undefined>(undefined);
    return (props) => {
      const targetWindow = React.useContext(WindowContext)?.windowRef?.deref();
      const cancellations = React.useRef(new Set<() => void>());
      React.useEffect(
        () => () => {
          for (const cancel of cancellations.current) cancel();
        },
        [props.channelId, props.threadTs, props.viewContext, targetWindow],
      );
      const send = props.sendMessage;
      const checkedSend = React.useCallback(
        (...args: any[]) => {
          if (!send || !checks.size || !props.channelId || !targetWindow) return send?.(...args);
          getInputProxy ??= getExport<GetInputProxy>(
            (exp: any) => typeof exp === 'function' && exp.name === 'getInputProxy',
          );
          const key = {
            channelId: props.channelId,
            threadTs: props.threadTs,
            viewContext: props.viewContext,
            targetWindow,
          };
          const input = getInputProxy?.(key);
          const contents = input?.getContents?.()?.contents;
          const quill = input?.getContainer?.()?.__quill;
          if (!contents || !quill) return send(...args);
          pending.get(quill)?.();

          let blocks: Block[];
          try {
            blocks = fromDeltaNow(contents);
          } catch (error) {
            console.error('[slick] send checks could not read the message:', error);
            return send(...args);
          }
          const context = { channelId: props.channelId, threadTs: props.threadTs, targetWindow };
          const passed = runChecks([...checks], blocks, context);
          if (passed === true) return send(...args);
          if (!passed) return;

          const snapshot = JSON.stringify(contents);
          let active = true;
          const cancel = () => {
            active = false;
            quill.off('text-change', onChange);
            cancellations.current.delete(cancel);
            if (pending.get(quill) === cancel) pending.delete(quill);
          };
          const onChange: TextChange = (_change, _old, source) => {
            if (source === 'user') cancel();
          };
          quill.on('text-change', onChange);
          cancellations.current.add(cancel);
          pending.set(quill, cancel);
          return passed.then(
            (ok) => {
              const unchanged =
                active &&
                getInputProxy?.(key) === input &&
                JSON.stringify(input.getContents?.()?.contents) === snapshot;
              cancel();
              if (ok && unchanged) return send(...args);
            },
            (error) => {
              cancel();
              throw error;
            },
          );
        },
        [send, props.channelId, props.threadTs, props.viewContext, targetWindow],
      );
      return <Original {...props} sendMessage={send ? checkedSend : send} />;
    };
  });

  return function addSendCheck(check: SendCheck): () => void {
    const registered = { check, label: registrationLabel(check) };
    checks.add(registered);
    return () => checks.delete(registered);
  };
}
