import { EARLY_CORE_SYMBOL, type EarlyCore } from './earlyCore.ts';

const global = globalThis as Record<PropertyKey, unknown>;
export const earlyCore = global[EARLY_CORE_SYMBOL] as EarlyCore | undefined;
delete global[EARLY_CORE_SYMBOL];
