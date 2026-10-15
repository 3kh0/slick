type ThunkCreator = (...args: any[]) => any;
type Matcher = (value: any) => boolean;
type Wrapper = (original: ThunkCreator) => ThunkCreator;
type Patch = { order: number; match: string | Matcher; wrap: Wrapper };

/** Exact names skip unrelated hooks; predicates still run on every invocation. */
export function createThunkPatches() {
  const named = new Map<string, Set<Patch>>();
  const predicates = new Set<Patch>();
  const plans = new Map<string, Patch[]>();
  let generic: Patch[] = [];
  let nextOrder = 0;
  let version = 0;

  function rebuildPlans() {
    version++;
    generic = [...predicates];
    plans.clear();
    for (const [name, entries] of named) {
      const plan = [...entries, ...generic];
      if (generic.length) plan.sort((a, b) => a.order - b.order);
      plans.set(name, plan);
    }
  }

  function patch(match: string | Matcher, wrap: Wrapper): () => void {
    const entry = { order: nextOrder++, match, wrap };
    let group = typeof match === 'string' ? named.get(match) : predicates;
    if (!group) {
      group = new Set();
      named.set(match as string, group);
    }
    group.add(entry);
    rebuildPlans();
    return () => {
      if (!group.delete(entry)) return;
      if (typeof match === 'string' && !group.size) named.delete(match);
      rebuildPlans();
    };
  }

  function wrapCreator(original: ThunkCreator): ThunkCreator {
    return new Proxy(original, {
      apply(target, thisArg, args) {
        let name: unknown;
        if (named.size) {
          try {
            name = (target as any).meta?.name;
          } catch {}
        }
        let candidates = (typeof name === 'string' && plans.get(name)) || generic;
        let seenVersion = version;
        let creator = target;
        for (let index = 0; index < candidates.length; index++) {
          const entry = candidates[index];
          let matched = true;
          if (typeof entry.match === 'function') {
            try {
              matched = entry.match(target);
            } catch {
              matched = false;
            }
          }
          // Build wrappers per call: plugins may read live settings here.
          if (matched) {
            try {
              creator = entry.wrap(creator);
            } catch (error) {
              console.error('[slick] thunk wrapper threw:', error);
            }
          }
          if (seenVersion !== version) {
            // A hook may synchronously stop/start another plugin. Preserve the
            // old Set iteration behavior: skip removals and visit new hooks.
            // There may have been no named hooks when this invocation began.
            name = undefined;
            if (named.size) {
              try {
                name = (target as any).meta?.name;
              } catch {}
            }
            candidates = (typeof name === 'string' && plans.get(name)) || generic;
            seenVersion = version;
            const next = candidates.findIndex((candidate) => candidate.order > entry.order);
            if (next < 0) break;
            index = next - 1;
          }
        }
        return Reflect.apply(creator, thisArg, args);
      },
    });
  }

  return { patch, wrapCreator };
}
