// One shared hook on outgoing message content.
//
// Slack hands the composer's Quill Delta to three different components, so
// every plugin that wants to rewrite an outgoing message would otherwise patch
// all three itself. Patching them once and letting plugins register transforms
// also means the transforms compose instead of fighting: two plugins patching
// `prepareAndSendMessage` independently would each wrap the other's props and
// whichever rendered last would win.
//
// This replaces v1's approach of rewriting the JSON request body on its way
// out, which had to re-parse what Slack had already serialized.

import type { Delta } from '../../shared/delta.ts';
import type { ComponentReplacer } from '../slack/react.tsx';

type PatchComponent = <P>(name: string, replacer: ComponentReplacer<P>) => () => void;

type SendProps = { prepareAndSendMessage: (opts: { delta: Delta }) => Promise<unknown> };
type EditProps = { prepareAndSaveEditMessage: (opts: { delta: Delta }) => Promise<unknown> };

export type DeltaTransform = (delta: Delta) => Delta;

type RegisteredTransform = { transform: DeltaTransform; label: string };

function isUsableDelta(value: unknown, input: Delta): value is Delta {
  if (!value || typeof value !== 'object' || !Array.isArray((value as Delta).ops)) return false;

  const InputDelta = input.constructor;
  if (typeof InputDelta !== 'function' || !(value instanceof InputDelta)) return false;

  return (value as Delta).ops.every((op) => {
    if (!op || typeof op !== 'object' || Array.isArray(op)) return false;
    const kinds = ['insert', 'delete', 'retain'].filter((key) => key in op);
    if (kinds.length !== 1) return false;
    if ('insert' in op && typeof op.insert !== 'string' && (typeof op.insert !== 'object' || !op.insert)) return false;
    if ('delete' in op && (typeof op.delete !== 'number' || !Number.isFinite(op.delete) || op.delete < 0)) return false;
    if ('retain' in op && (typeof op.retain !== 'number' || !Number.isFinite(op.retain) || op.retain < 0)) return false;
    return !('attributes' in op) || (typeof op.attributes === 'object' && op.attributes !== null);
  });
}

export function setupMessageSendDelta(patchComponent: PatchComponent) {
  const transforms = new Map<DeltaTransform, RegisteredTransform>();
  let nextTransformId = 1;

  function applyTransforms(delta: Delta): Delta {
    let result = delta;
    // Map iteration is registration order, including after removals.
    for (const registered of transforms.values()) {
      const input = result;
      try {
        const transformed = registered.transform(input);
        if (isUsableDelta(transformed, input)) {
          result = transformed;
        } else {
          console.error(`[slick] message transform ${registered.label} returned an invalid Delta; ignoring it`);
        }
      } catch (error) {
        console.error(`[slick] message transform ${registered.label} failed; ignoring it:`, error);
      }
    }
    return result;
  }

  for (const name of ['MessagePaneInput', 'InputContainer'] as const) {
    patchComponent<SendProps>(name, (Original) => (props) => {
      const send = React.useCallback(
        (opts: { delta: Delta }) => props.prepareAndSendMessage({ ...opts, delta: applyTransforms(opts.delta) }),
        [props.prepareAndSendMessage],
      );
      return <Original {...props} prepareAndSendMessage={send} />;
    });
  }

  patchComponent<EditProps>('BaseEditMessage', (Original) => (props) => {
    const save = React.useCallback(
      (opts: { delta: Delta }) => props.prepareAndSaveEditMessage({ ...opts, delta: applyTransforms(opts.delta) }),
      [props.prepareAndSaveEditMessage],
    );
    return <Original {...props} prepareAndSaveEditMessage={save} />;
  });

  /** Register a transform run over every outgoing message and edit. */
  return function onMessageSendDelta(transform: DeltaTransform): () => void {
    const registrationSite = new Error().stack
      ?.split('\n')
      .find((line) => line.includes(' at ') && !/messageSend|pluginManager/.test(line))
      ?.trim();
    // The registration site names the plugin bundle even when a malformed
    // return gives us no thrown stack of its own.
    const registered = {
      transform,
      label: `${transform.name || 'anonymous'} (#${nextTransformId++}${registrationSite ? `, ${registrationSite}` : ''})`,
    };
    transforms.set(transform, registered);
    return () => {
      transforms.delete(transform);
    };
  };
}
