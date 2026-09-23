import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'AdminBackend';
export const pluginName = 'Admin Backend';
export const description = 'Open profiles in Hack Club admin tools';
export const defaultEnabled = false;

export const settings = {
  identity: {
    type: 'boolean',
    label: 'Identity',
    description: 'Show the Identity backend',
    default: true,
  },
  joe: {
    type: 'boolean',
    label: 'Joe',
    description: 'Show the Joe fraud backend',
    default: true,
  },
  telescreen: {
    type: 'boolean',
    label: 'Telescreen',
    description: 'Show the Telescreen backend',
    default: true,
  },
  fire_engine: {
    type: 'boolean',
    label: 'Fire Engine',
    description: 'Show the Fire Engine backend',
    default: true,
  },
} as const satisfies SettingsSchema;

/** The tools offered, in menu order. The URLs live in the main half. */
export const TOOLS = [
  { id: 'identity', label: 'Open in Identity' },
  { id: 'joe', label: 'Open in Joe' },
  { id: 'telescreen', label: 'Open in Telescreen' },
  { id: 'fire_engine', label: 'Open in Fire Engine' },
] as const;
