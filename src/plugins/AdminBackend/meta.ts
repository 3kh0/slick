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

/** The tools offered, in menu order, each with the one URL it may open. */
export const TOOLS = [
  {
    id: 'identity',
    label: 'Open in Identity',
    url: (member: string) => `https://auth.hackclub.com/backend/identities?search=${encodeURIComponent(member)}`,
  },
  {
    id: 'joe',
    label: 'Open in Joe',
    url: (member: string) => `https://joe.fraud.hackclub.com/profile/${encodeURIComponent(member)}`,
  },
  {
    id: 'telescreen',
    label: 'Open in Telescreen',
    url: (member: string) => `https://telescreen.hackclub.com/subjects/${encodeURIComponent(member)}`,
  },
  {
    id: 'fire_engine',
    label: 'Open in Fire Engine',
    url: (member: string) => `https://nemo.hackclub.com/fd/members/${encodeURIComponent(member)}`,
  },
] as const;

export const USER_ID = /^[UW][A-Z0-9]{6,}$/;
