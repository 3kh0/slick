// Opt into Slack's existing tracked-state fast paths without replacing its
// implementation or writing stored experiment assignments. The caller installs
// this patcher before Slack initializes; these choices apply for that boot.

type Gate = (...args: any[]) => any;

export type NativeStateGateOptions = {
  sharedStateDescriptors: boolean;
  stableSelectorShapes: boolean;
};

const gateSpecs = [
  {
    option: 'sharedStateDescriptors',
    name: 'shouldShareReduxStateDescriptors',
    enumKey: 'ReduxSharedStateDescriptors',
    toggleName: 'redux_shared_state_descriptors',
  },
  {
    option: 'stableSelectorShapes',
    name: 'shouldUseHotPathStableShapes',
    enumKey: 'HotPathStableShapes',
    toggleName: 'hot_path_stable_shapes',
  },
] as const;

const sourcePatterns = gateSpecs.map(
  ({ name, enumKey }) =>
    new RegExp(
      `^function\\s+${name}\\s*\\([^)]*\\)\\s*\\{\\s*return\\s+[$\\w]+\\s*\\(\\s*[$\\w]+\\s*\\.\\s*${enumKey}\\s*(?:,\\s*(?:\\.\\.\\.)?[$\\w]+\\s*)*\\)\\s*;?\\s*\\}$`,
    ),
);

/** Snapshot the requested options; changing settings requires a renderer reload. */
export function createNativeStateGatePatcher(options: NativeStateGateOptions): (namespace: any) => any | undefined {
  const enabled = gateSpecs.map(({ option }) => options[option] === true);
  if (!enabled.some(Boolean)) return () => undefined;

  const recognizedGates = new WeakMap<Gate, number>();
  const wrappers = new WeakMap<Gate, Gate>();

  const recognizeGate = (value: unknown): number | undefined => {
    if (typeof value !== 'function') return;
    try {
      const index = gateSpecs.findIndex((spec, i) => enabled[i] && value.name === spec.name);
      if (index === -1) return;
      const gate = value as Gate;
      const known = recognizedGates.get(gate);
      if (known === index) return index;
      // Require the observed direct session-toggle call, not just a name or enum
      // text in a comment/string. Different implementations retain native behavior.
      if (!sourcePatterns[index].test(Function.prototype.toString.call(gate))) return;
      recognizedGates.set(gate, index);
      return index;
    } catch {
      return;
    }
  };

  const wrapGate = (original: Gate): Gate => {
    let wrapped = wrappers.get(original);
    if (!wrapped) {
      wrapped = function slickNativeStateGate() {
        return true;
      };
      Object.defineProperty(wrapped, 'name', { value: original.name, configurable: true });
      wrappers.set(original, wrapped);
    }
    return wrapped;
  };

  return (namespace) => {
    if (!namespace || typeof namespace !== 'object') return;
    let gates: { key: string; index: number }[] | undefined;
    let recognizedEnums = 0;

    for (const key in namespace) {
      if (!Object.hasOwn(namespace, key)) continue;
      try {
        const value = namespace[key];
        if (value && typeof value === 'object') {
          for (let i = 0; i < gateSpecs.length; i++) {
            const spec = gateSpecs[i];
            if (enabled[i] && Object.getOwnPropertyDescriptor(value, spec.enumKey)?.value === spec.toggleName) {
              recognizedEnums |= 1 << i;
            }
          }
        }
        const index = recognizeGate(value);
        if (index !== undefined) (gates ??= []).push({ key, index });
      } catch {
        // An unrelated lazy export must not prevent Slack's module loading.
      }
    }
    if (!recognizedEnums || !gates?.some(({ index }) => recognizedEnums & (1 << index))) return;

    const checkedGate = (value: unknown): unknown => {
      const index = recognizeGate(value);
      return index !== undefined && recognizedEnums & (1 << index) ? wrapGate(value as Gate) : value;
    };
    const descriptors = Object.getOwnPropertyDescriptors(namespace);
    for (const { key, index } of gates) {
      if (!(recognizedEnums & (1 << index))) continue;
      const descriptor = descriptors[key];
      if (!descriptor) continue;
      if ('value' in descriptor) {
        descriptors[key] = { ...descriptor, value: checkedGate(descriptor.value) };
      } else {
        const read = descriptor.get;
        if (!read) continue;
        descriptors[key] = {
          ...descriptor,
          get(this: unknown) {
            return checkedGate(Reflect.apply(read, this, []));
          },
        };
      }
    }
    const replacement = Object.create(Object.getPrototypeOf(namespace), descriptors);
    if (!Object.isExtensible(namespace)) Object.preventExtensions(replacement);
    return replacement;
  };
}
