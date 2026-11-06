import type { SlackMessage } from '$slick';

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function blockText(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return;
  const node = value as Record<string, unknown>;
  switch (node.type) {
    case 'text':
    case 'plain_text':
      return typeof node.text === 'string' ? escape(node.text) : undefined;
    case 'mrkdwn':
      return typeof node.text === 'string' ? node.text : undefined;
    case 'link':
      return typeof node.text === 'string' ? escape(node.text) : typeof node.url === 'string' ? escape(node.url) : '';
    case 'user':
      return typeof node.user_id === 'string' ? `<@${node.user_id}>` : '';
    case 'channel':
      return typeof node.channel_id === 'string' ? `<#${node.channel_id}>` : '';
    case 'emoji':
      return typeof node.name === 'string' ? `:${node.name}:` : '';
    case 'broadcast':
      return typeof node.range === 'string' ? `<!${node.range}>` : '';
    case 'usergroup':
      return typeof node.usergroup_id === 'string' ? `<!subteam^${node.usergroup_id}>` : '';
    case 'date':
      return typeof node.fallback === 'string' ? escape(node.fallback) : undefined;
    case 'section':
    case 'header': {
      const parts = [node.text, ...(Array.isArray(node.fields) ? node.fields : [])]
        .map(blockText)
        .filter((text) => text !== undefined);
      return parts.length ? parts.join('\n') : undefined;
    }
    case 'rich_text':
    case 'rich_text_section':
    case 'rich_text_list':
    case 'rich_text_quote':
    case 'rich_text_preformatted': {
      if (!Array.isArray(node.elements)) return;
      const parts = node.elements.map(blockText).filter((text) => text !== undefined);
      return parts.length
        ? parts.join(node.type === 'rich_text' || node.type === 'rich_text_list' ? '\n' : '')
        : undefined;
    }
    default:
      return;
  }
}

export function blocksText(message: SlackMessage): string | undefined {
  if (!Array.isArray(message.blocks)) return;
  const parts = message.blocks.map(blockText).filter((text) => text !== undefined);
  return parts.length ? parts.join('\n') : undefined;
}

export function messageText(message: SlackMessage | undefined): string {
  if (!message) return '';
  const text = blocksText(message) ?? (typeof message.text === 'string' ? message.text : '');
  return text
    .replace(/<([^>|]+)\|([^>]+)>/g, '$2')
    .replace(/<([^>]+)>/g, '$1')
    .replace(/&(amp|lt|gt);/g, (_, entity: string) => ({ amp: '&', lt: '<', gt: '>' })[entity]!)
    .trim();
}

export function hasEvasionPadding(message: SlackMessage | undefined): boolean {
  if (!message || !Array.isArray(message.blocks) || typeof message.text !== 'string') return false;
  if (messageText(message) === messageText({ text: message.text })) return false;
  const padded = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false;
    const node = value as Record<string, unknown>;
    if (
      node.type === 'link' &&
      typeof node.text === 'string' &&
      !node.text.replace(/[\s\u200b-\u200f\u2060\ufeff]/g, '') &&
      typeof node.url === 'string'
    ) {
      let controls = 0;
      for (let i = 0; i < node.url.length; i++) {
        if (node.url.charCodeAt(i) < 32 && ++controls >= 1024) return true;
      }
    }
    return Array.isArray(node.elements) && node.elements.some(padded);
  };
  return message.blocks.some(padded);
}
