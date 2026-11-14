import { EventBuffers } from './events.ts';
import type { SlickAPI } from '$slick';
import type { PluginManager } from '../../app/pluginManager.ts';
import type { ConfigStore } from '../../app/configStore.ts';
import { getActiveTeam, readLocalConfig } from '../../app/slack/localConfig.ts';
import { resolveSettings } from '../../shared/settings.ts';
import { resolveSlackLink, unreadConversations, waitForEvent, type EventFilter } from './features.ts';

type AgentManager = Pick<PluginManager, 'info'> & { config: Pick<ConfigStore, 'settingsFor' | 'update'> };

export const rendererActions = new Set([
  'get_unreads',
  'get_activity',
  'get_draft',
  'set_draft',
  'resolve_link',
  'wait_for_event',
  'cancel_wait',
  'list_plugins',
  'configure_plugin',
  'download_info',
  'subscribe_events',
  'poll_events',
  'unsubscribe_events',
]);

export class AgentFeatures {
  private api: SlickAPI;
  private events: EventBuffers;
  private waits = new Map<string, AbortController>();

  constructor(api: SlickAPI) {
    this.api = api;
    this.events = new EventBuffers(
      (listener) => this.api.rtm.on('*', listener),
      Date.now,
      () => {
        const team = getActiveTeam();
        return `${team?.id}:${team?.user_id}`;
      },
    );
  }

  stop() {
    for (const controller of this.waits.values()) controller.abort();
    this.waits.clear();
    this.events.stop();
  }

  async run(action: string, args: Record<string, any>): Promise<any> {
    if (action === 'subscribe_events') return this.events.create(args as EventFilter);
    if (action === 'poll_events') return this.events.poll(args.subscription_id, args.cursor, args.limit);
    if (action === 'unsubscribe_events') return this.events.remove(args.subscription_id);
    if (action === 'get_unreads')
      return unreadConversations(
        await this.api.userAPI('client.counts', {}, { signal: this.api.signal }),
        args.offset,
        args.limit,
      );
    if (action === 'get_activity') {
      const response = await this.api.userAPI(
        'activity.feed',
        {
          limit: String(args.limit),
          types: JSON.stringify(args.types),
          mode: args.unread_only ? 'chrono_unreads' : 'chrono_reads_and_unreads',
          unread_only: String(args.unread_only),
          is_activity_inbox: 'true',
          ...(args.cursor ? { cursor: args.cursor } : {}),
        },
        { signal: this.api.signal },
      );
      if (args.include_content) return response;
      return {
        ...response,
        items: response.items?.map((entry: any) => ({
          key: entry.key,
          feed_ts: entry.feed_ts,
          is_unread: entry.is_unread,
          is_archived: entry.is_archived,
          type: entry.item?.type,
        })),
      };
    }
    if (action === 'resolve_link') {
      const config = readLocalConfig();
      const host = new URL(args.url).hostname;
      const matching = Object.values(config.teams ?? {}).find(
        (team) => team.domain && host === `${team.domain}.slack.com`,
      );
      return resolveSlackLink(args.url, matching?.id || getActiveTeam(config)?.id);
    }
    if (action === 'get_draft' || action === 'set_draft') {
      const node = document.querySelector<HTMLElement>(args.target);
      const editor = node?.matches('.ql-editor') ? node : node?.querySelector<HTMLElement>('.ql-editor');
      const quill = (editor?.parentElement as (HTMLElement & { __quill?: any }) | null)?.__quill;
      if (!quill)
        throw new Error('No Slack composer found at this target. Open the destination channel or thread first.');
      if (action === 'set_draft') {
        if ((args.text === undefined) === (args.ops === undefined))
          throw new Error('Supply exactly one of text or ops');
        if (args.ops !== undefined) {
          if (args.append) quill.updateContents({ ops: [{ retain: quill.getLength() - 1 }, ...args.ops] }, 'user');
          else quill.setContents({ ops: args.ops }, 'user');
        } else if (args.append) quill.insertText(quill.getLength() - 1, args.text, 'user');
        else quill.setText(args.text, 'user');
        quill.focus();
      }
      return {
        text: quill.getText(),
        ops: quill.getContents().ops,
        selection: quill.getSelection(),
        length: quill.getLength(),
      };
    }
    if (action === 'cancel_wait') {
      this.waits.get(args.request_id)?.abort();
      return { cancelled: true };
    }
    if (action === 'wait_for_event') {
      if (this.waits.size >= 32) throw new Error('Too many concurrent event waits in this window');
      const controller = new AbortController();
      this.waits.set(args.request_id, controller);
      try {
        return await waitForEvent(
          (listener) => this.api.rtm.on('*', listener),
          args as EventFilter,
          AbortSignal.any([this.api.signal, controller.signal]),
        );
      } finally {
        this.waits.delete(args.request_id);
      }
    }
    if (action === 'list_plugins' || action === 'configure_plugin') {
      const manager = (globalThis as unknown as { __slickPluginManager: AgentManager }).__slickPluginManager;
      if (action === 'list_plugins') {
        return manager
          .info()
          .filter(
            (plugin) => !args.query || `${plugin.id} ${plugin.name}`.toLowerCase().includes(args.query.toLowerCase()),
          )
          .map((plugin) => ({
            id: plugin.id,
            name: plugin.name,
            enabled: plugin.enabled,
            running: plugin.running,
            start_error: plugin.startError,
            ...(args.include_settings
              ? { schema: plugin.settings, values: manager.config.settingsFor(plugin.id) }
              : {}),
          }));
      }
      const info = manager.info().find((plugin) => plugin.id === args.id);
      if (!info) throw new Error('Unknown Slick plugin ID');
      const changes = { ...args.settings, ...(args.enabled === undefined ? {} : { enabled: args.enabled }) };
      if (!Object.keys(changes).length) throw new Error('Supply enabled or at least one setting');
      for (const key of Object.keys(changes))
        if (key !== 'enabled' && !Object.hasOwn(info.settings, key)) throw new Error(`Unknown setting: ${key}`);
      const resolved = resolveSettings(info.settings, info.defaultEnabled, {
        ...manager.config.settingsFor(args.id),
        ...changes,
      });
      for (const [key, value] of Object.entries(changes))
        if (JSON.stringify(resolved[key]) !== JSON.stringify(value))
          throw new Error(`Invalid value for setting: ${key}`);
      const saved = await manager.config.update((config) => {
        config.plugins ??= {};
        config.plugins[args.id] = { ...config.plugins[args.id], ...changes };
      });
      if (!saved) throw new Error('Could not save plugin settings');
      return {
        id: args.id,
        values: manager.config.settingsFor(args.id),
        needs_relaunch: Object.keys(changes).some((key) => info.relaunchSettings.includes(key)),
      };
    }
    if (action === 'download_info') {
      const response = await this.api.userAPI('files.info', { file: args.file }, { signal: this.api.signal });
      const file = response.file;
      if (!file?.url_private_download && !file?.url_private)
        throw new Error('Slack did not provide a downloadable file URL');
      return {
        url: file.url_private_download || file.url_private,
        token: getActiveTeam()?.token,
        name: file.name,
        mimetype: file.mimetype,
        size: file.size,
        id: file.id,
      };
    }
    throw new Error(`Unknown feature action: ${action}`);
  }
}
