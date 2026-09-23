import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'OfficeHours';
export const pluginName = 'Office Hours';
export const description = 'Set schedules for out-of-office and invisible status';
export const defaultEnabled = false;

export const settings = {
  inOffice: {
    type: 'select',
    label: 'In-office presence',
    description: 'What an invisible window hands back to when it ends',
    default: 'auto',
    options: [
      { value: 'auto', label: 'Active' },
      { value: 'away', label: 'Away' },
    ],
  },
  schedule: {
    type: 'schedule',
    label: 'Out of office times',
    description:
      'Times are 24-hour, in this computer’s time zone. Change your status by hand during a window and it is left alone until the window ends.',
    default: [],
    statuses: [
      { value: 'ooo', label: 'Out of office' },
      { value: 'invisible', label: 'Invisible' },
    ],
  },
  oooMessage: {
    type: 'text',
    label: 'Out of office message',
    description: 'Sent to people who mention or message you while you’re out (optional)',
    default: '',
    maxLength: 200,
  },
  pauseNotifications: {
    type: 'boolean',
    label: 'Pause notifications while out of office',
    default: false,
  },
} as const satisfies SettingsSchema;
