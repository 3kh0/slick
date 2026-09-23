import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'HcaStatus';
export const pluginName = 'HCA Status';
export const description = 'Flag users who have not completed identity verification';
export const defaultEnabled = false;

export const settings = {
  unverifiedColor: {
    type: 'color',
    label: 'Unverified color',
    description: 'Underline color for users who have not verified',
    default: '#e01e5a',
  },
  over18Color: {
    type: 'color',
    label: 'Over-18 color',
    description: 'Underline color for users verified as over 18',
    default: '#d97706',
  },
} as const satisfies SettingsSchema;

export type HcaStatus = 'eligible' | 'over_18' | 'unverified';
