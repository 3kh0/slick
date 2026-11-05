import type { PluginCategory, SettingsSchema } from '../../shared/settings.ts';

export const id = 'AdminBackend';
export const pluginName = 'Admin Backend';
export const description = 'Open profiles in Hack Club admin tools';
export const category: PluginCategory = 'hackclub';
export const defaultEnabled = false;

export const settings = {
  identity: {
    type: 'boolean',
    label: 'Identity',
    description: 'Show the Identity backend',
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
  attend: {
    type: 'boolean',
    label: 'Attend',
    description: 'Show the Attend backend',
    default: true,
  },
} as const satisfies SettingsSchema;

export const TOOLS = [
  {
    id: 'identity',
    label: 'Open in Identity',
    url: (member: string) => `https://auth.hackclub.com/backend/identities?search=${encodeURIComponent(member)}`,
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
  {
    id: 'attend',
    label: 'Open in Attend',
    url: (member: string) => `https://attend.hackclub.com/admin/users?search=${encodeURIComponent(member)}`,
  },
] as const;

export const USER_ID = /^[UW][A-Z0-9]{6,}$/;
