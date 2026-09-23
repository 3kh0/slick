import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'ShowRealUser';
export const pluginName = 'Show Real User';
export const description = 'Show who actually sent a message when a relay bot posts on their behalf';
export const defaultEnabled = true;

export const settings = {} as const satisfies SettingsSchema;
