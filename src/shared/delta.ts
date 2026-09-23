// Quill Delta shape from Slack's composer. Declared, not imported: Slick never
// bundles Quill. See https://github.com/slab/delta

export type DeltaOp = ({ insert?: string | object } | { delete?: number } | { retain?: number }) & {
  attributes?: Record<string, any>;
};

export declare class Delta {
  // Brand so a plain `{ ops }` can't satisfy it: Slack calls methods on the result.
  private _quillDeltaBrand: never;
  ops: DeltaOp[];
}
