// The Quill Delta shape, as Slack's composer produces it.
//
// Declared rather than imported: Slick never bundles Quill, it only hands
// Slack's own Delta instances back and forth. See https://github.com/slab/delta

export type DeltaOp = ({ insert?: string | object } | { delete?: number } | { retain?: number }) & {
  attributes?: Record<string, any>;
};

export declare class Delta {
  // A private brand, so a plain `{ ops: [...] }` cannot satisfy this type: a
  // transform has to return a real Delta, because Slack calls methods on it.
  private _quillDeltaBrand: never;
  ops: DeltaOp[];
}
