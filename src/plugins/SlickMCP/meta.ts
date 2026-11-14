import type { PluginCategory, SettingsSchema } from '$slick';

export const id = 'SlickMCP';
export const pluginName = 'Slick MCP';
export const description = 'Connect local AI agents to Slack with search, messaging, and desktop controls.';
export const category: PluginCategory = 'app';
export const defaultEnabled = false;
export const settings = {
  port: {
    type: 'number',
    label: 'Local server port',
    default: 38465,
    min: 1024,
    max: 65535,
    description: 'Connect agents from the Slick MCP tab. Connected agents can read and act as you in Slack.',
  },
} as const satisfies SettingsSchema;
