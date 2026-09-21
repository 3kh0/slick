// A minimal reactive value, readable from inside a React render.
//
// `useSyncExternalStore` rather than `useState` so a value that changes
// between render and subscribe cannot be missed.

export class Store<T> {
  private value: T;
  private target = new EventTarget();

  constructor(initial: T) {
    this.value = initial;
  }

  get = (): T => this.value;

  set = (next: T): void => {
    this.value = next;
    this.notify();
  };

  update = (updater: (value: T) => T): void => {
    this.value = updater(this.value);
    this.notify();
  };

  private notify() {
    this.target.dispatchEvent(new Event('change'));
  }

  subscribe = (onChange: () => void): (() => void) => {
    this.target.addEventListener('change', onChange);
    return () => this.target.removeEventListener('change', onChange);
  };

  /** Reactively read the current value inside a component. */
  use = (): T => React.useSyncExternalStore(this.subscribe, this.get);
}
