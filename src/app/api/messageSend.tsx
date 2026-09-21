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

export function setupMessageSendDelta(patchComponent: PatchComponent) {
  const transforms = new Set<DeltaTransform>();

  function applyTransforms(delta: Delta): Delta {
    let result = delta;
    for (const transform of transforms) result = transform(result);
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
    transforms.add(transform);
    return () => {
      transforms.delete(transform);
    };
  };
}
