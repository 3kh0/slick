import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'HuddleMuteDetector';
export const pluginName = 'Huddle Mute Detector';
export const description = 'Show who muted you in a huddle';
export const defaultEnabled = false;

export const settings = {} as const satisfies SettingsSchema;
