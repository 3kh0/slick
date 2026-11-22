import type { EarlyCore } from './early.ts';

const g = globalThis as Record<PropertyKey, unknown>;
const k = Symbol.for('slick.earlyCore');
export const earlyCore = g[k] as EarlyCore | undefined;
delete g[k];
