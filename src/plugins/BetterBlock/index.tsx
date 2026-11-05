import { SlickPlugin, type MenuTemplateItem, type SlackMessage, type SlackStore } from '$slick';
import {
  blockedDm,
  filterHistory,
  filterMessage,
  filterMemberResults,
  filterReaction,
  filterReactions,
  filterThreadActivity,
  filterTyping,
  hasBlockedReplies,
  hidesActivity,
  hidesMessage,
  isBlocked,
  isThreadActivity,
  keep,
  projectSuggestions,
  record,
  threadReplies,
  type Data,
} from './filter.ts';
import * as meta from './meta.ts';
import { BlockedDmReader } from './autoRead.ts';

type RowProps = { msg?: SlackMessage; message?: SlackMessage; channelId?: string };
const MENU_KEY = 'slick-betterblock-toggle';

export default class BetterBlock extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly requiredAPIs = ['redux', 'members', 'modal', 'rtm'] as const;
  static readonly liveSettings = ['blockedUsers', 'includeHiddenUsers'];

  private blocked = new Set<string>();
  private hiddenUsers: unknown;
  private selfId: string | undefined;
  private unsubscribe?: () => void;
  private observedStore?: SlackStore | null;
  private storePoll?: ReturnType<typeof setInterval>;
  private dmReader?: BlockedDmReader;
  private messages = new WeakMap<SlackMessage, SlackMessage>();
  private histories = new WeakMap<object, { messages: unknown; result: object }>();
  private typers = new WeakMap<object, Data>();
  private activities = new WeakMap<object, { messages: unknown; result: Data }>();
  private activitySources = new WeakMap<object, Data>();
  private fetchedThreads = new Map<string, unknown>();
  private readonly ProfileContext = React.createContext<string | null>(null);

  private syncBlocked = () => {
    const state = this.api.redux.getRawState();
    const self = state?.bootData?.user_id;
    const hidden = state?.hiddenUsers;
    this.hiddenUsers = hidden;
    this.selfId = self;
    const next = new Set<string>(Object.keys(this.config.blockedUsers));
    if (this.config.includeHiddenUsers) {
      for (const id in hidden) if (hidden[id] === true) next.add(id);
    }
    if (self) next.delete(self);
    if (next.size === this.blocked.size && [...next].every((id) => this.blocked.has(id))) return;
    this.blocked = next;
    this.messages = new WeakMap();
    this.histories = new WeakMap();
    this.typers = new WeakMap();
    this.activities = new WeakMap();
    this.api.redux.refresh();
    this.dmReader?.schedule();
  };

  private filtered = (message: SlackMessage): SlackMessage => {
    let result = this.messages.get(message);
    if (!result) {
      result = filterMessage(message, this.blocked);
      this.messages.set(message, result);
      // A row can receive an already-projected message from Redux.
      this.messages.set(result, result);
    }
    return result;
  };

  start() {
    this.syncBlocked();
    this.dmReader = new BlockedDmReader({
      getState: () => this.api.redux.getRawState(),
      getBlocked: () => this.blocked,
      isActive: () => this.api.isActive(),
      markRead: (id, ts) =>
        this.api.redux.dispatchThunk('markLastRead', { id, ts, immediate: true, reason: 'betterblock' }),
      onError: (error) => this.log('Could not mark blocked DM read', error),
    });
    this.api.rtm.on('message', (event) => this.dmReader?.onMessage(event));
    this.watchStore();
    // Follow late-mounted Providers and replacement stores on workspace switches.
    this.storePoll = setInterval(() => this.watchStore(), 500);
    this.api.signal.addEventListener('abort', () => this.stop(), { once: true });

    this.api.redux.patchSlice('messages', (_channel, bucket) => {
      if (!bucket || !this.blocked.size) return bucket;
      let threads: Map<string, Data[]> | undefined;
      return this.api.redux.mapEntries<SlackMessage>(bucket, (ts, message) => {
        if (!message || !hasBlockedReplies(message, this.blocked)) return message && this.filtered(message);
        const replies = (threads ??= threadReplies(bucket)).get(ts);
        return replies ? filterMessage(message, this.blocked, replies) : this.filtered(message);
      });
    });
    this.api.redux.patchSlice('reactions', (_key, reactions) =>
      Array.isArray(reactions) && this.blocked.size ? filterReactions(reactions, this.blocked) : reactions,
    );
    this.api.redux.patchState((state) => {
      if (!state.typing || !this.blocked.size) return state;
      let typing = this.typers.get(state.typing);
      if (!typing) {
        typing = filterTyping<Data>(state.typing, this.blocked);
        this.typers.set(state.typing, typing);
      }
      return typing === state.typing ? state : { ...state, typing };
    });

    // Collapse virtual rows via history; retain messages for reducers and pagination.
    this.api.redux.patchState((state) => {
      if (!this.blocked.size || !state.channelHistory) return state;
      return {
        ...state,
        channelHistory: this.api.redux.mapEntries(state.channelHistory, (key, history) => {
          if (!history) return history;
          const bucket = state.messages?.[key.split('-')[0]];
          const cached = this.histories.get(history);
          if (cached && cached.messages === bucket) return cached.result;
          const result = filterHistory(history, bucket, this.blocked);
          this.histories.set(history, { messages: bucket, result });
          return result;
        }),
      };
    });
    this.patchRows();
    this.patchReactions();
    this.patchOtherSurfaces();
    this.patchMenus();
    this.patchAutocomplete();
    this.patchProfilePopups();
    this.patchNotifications();
  }

  onSettingsChange() {
    this.syncBlocked();
  }
  stop() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.storePoll) clearInterval(this.storePoll);
    this.storePoll = undefined;
    this.observedStore = undefined;
    this.dmReader?.stop();
  }

  private watchStore() {
    const store = this.api.redux.getStore();
    if (store === this.observedStore) return;
    this.unsubscribe?.();
    this.observedStore = store;
    const changed = () => {
      const state = this.api.redux.getRawState();
      if (state?.hiddenUsers !== this.hiddenUsers || state?.bootData?.user_id !== this.selfId) this.syncBlocked();
      this.dmReader?.observe();
    };
    this.unsubscribe = store?.subscribe(changed);
    changed();
  }

  private patchRows() {
    // Search, threads and recovered messages can bypass history or retain stale props.
    for (const name of [
      'MessageWrapper',
      'Message',
      'ThreadRootGeneric',
      'ThreadReplyGeneric',
      'MessageBackground',
      'MessageText',
      'Blocks',
      'MessageFiles',
      'MessageKitAttachments',
      'BaseVisuallyHiddenMessageText',
    ]) {
      this.api.patchComponent<RowProps>(name, (Original) => (props) => {
        this.api.redux.usePatchVersion();
        const message = this.currentMessage(props.msg ?? props.message, props.channelId);
        if (hidesMessage(message, this.blocked)) return null;
        if (!message) return <Original {...props} />;
        return <Original {...props} {...{ [props.msg ? 'msg' : 'message']: this.filtered(message) }} />;
      });
    }
    this.api.patchComponent<Data>('MessageListItem', (Original) => (props) => {
      this.api.redux.usePatchVersion();
      const messages = props.result?.messages;
      if (!Array.isArray(messages)) return <Original {...props} />;
      // Promoting context into a blocked hit would expose its highlighted snippet.
      if (hidesMessage(messages[0], this.blocked)) return null;
      const visible = keep(messages, (message) => !hidesMessage(message, this.blocked)).map(this.filtered);
      return <Original {...props} result={{ ...props.result, messages: visible }} />;
    });
    this.api.patchComponent<RowProps>('ThreadReplies', (Original) => (props) => {
      this.api.redux.usePatchVersion();
      const message = this.currentMessage(props.msg, props.channelId);
      const channelId = message?.channel ?? props.channelId;
      React.useEffect(() => {
        if (channelId && message?.ts) this.loadReplies(channelId, message.ts);
      }, [channelId, message?.ts, message?.reply_count]);
      return <Original {...props} msg={message && this.filtered(message)} />;
    });
  }

  private loadReplies(channelId: string, threadTs: string) {
    const bucket = this.api.redux.getRawState()?.messages?.[channelId];
    const root = bucket?.[threadTs];
    if (!root?.reply_count || root.reply_count >= 1000 || !hasBlockedReplies(root, this.blocked)) return;
    const key = `${channelId}-${threadTs}`;
    if (this.fetchedThreads.get(key) === root.latest_reply) return;
    if ((threadReplies(bucket).get(threadTs)?.length ?? 0) >= root.reply_count) return;
    this.fetchedThreads.set(key, root.latest_reply);
    this.api.redux
      .dispatchThunk('requestReplies', {
        channelId,
        threadTs,
        limit: root.reply_count + 1,
        reason: 'betterblock',
        skipSubscriptionUpdate: true,
      })
      .catch((error) => this.log('Could not load thread replies', error));
  }

  // connect() retains projected props; re-read so unblocking restores their contents.
  private currentMessage(message: SlackMessage | undefined, channelId?: string): SlackMessage | undefined {
    const channel = message?.channel ?? channelId;
    return (
      (channel && message?.ts ? this.api.redux.getStore()?.getState()?.messages?.[channel]?.[message.ts] : undefined) ??
      message
    );
  }

  private patchReactions() {
    this.api.patchComponent<Data>('ReactionBar', (Original) => (props) => {
      this.api.redux.usePatchVersion();
      const stored = this.api.redux.useReduxState<Data[]>((state) =>
        props.reactionKey ? state.reactions?.[props.reactionKey] : undefined,
      );
      const source = stored ?? props.reactions;
      const reactions = Array.isArray(source) ? filterReactions(source, this.blocked) : source;
      return <Original {...props} reactions={reactions} />;
    });
    this.api.patchComponent<Data>('Reaction', (Original) => (props) => {
      this.api.redux.usePatchVersion();
      const reaction = filterReaction(props, this.blocked);
      return reaction ? <Original {...reaction} /> : null;
    });
  }

  private patchOtherSurfaces() {
    for (const name of [
      'ActivityItem',
      'ActivityRowContentSenderAvatarLayout',
      'ActivityRowContentSingleLine',
      'ActivityRowContentMultiLine',
      'ActivityRowContentDense',
      'ActivityRowContentDetailed',
      'ActivityThread',
    ]) {
      this.api.patchComponent<Data>(name, (Original) => (props) => {
        this.api.redux.usePatchVersion();
        const item = this.api.redux.useReduxState((state) =>
          this.projectActivity(props.activityItem ?? props.item, state),
        );
        const state = this.api.redux.getRawState() ?? {};
        const thread = isThreadActivity(item);
        if (
          (props.isDmTab && blockedDm(state.channels?.[props.msg?.channel], this.blocked)) ||
          (!thread && hidesMessage(props.msg, this.blocked)) ||
          hidesActivity(item, state, this.blocked)
        )
          return null;
        if (!thread || !item) return <Original {...props} />;
        const msg = hidesMessage(props.msg, this.blocked)
          ? state.messages?.[item.channelId]?.[item.feedTs ?? item.messageTs]
          : props.msg;
        const next = { ...props, [props.activityItem ? 'activityItem' : 'item']: item };
        if (props.msg) next.msg = msg && this.filtered(msg);
        if (name === 'ActivityThread')
          for (const key of ['messageTs', 'minUnreadTs', 'unreadCount']) next[key] = item[key];
        return <Original {...next} />;
      });
    }
    this.api.patchComponent<Data>('ChannelSidebar', (Original) => (props) => {
      this.api.redux.usePatchVersion();
      const channels = this.api.redux.getRawState()?.channels;
      const rows = Array.isArray(props.rows)
        ? keep(props.rows, (row) => row.type !== 'channel' || !blockedDm(channels?.[row.id], this.blocked))
        : props.rows;
      return <Original {...props} rows={rows} />;
    });
    for (const name of ['ActivityDM', 'DmsListItem', 'DmsChannel']) {
      this.api.patchComponent<Data>(name, (Original) => (props) => {
        this.api.redux.usePatchVersion();
        const state = this.api.redux.getRawState();
        const channel = state?.channels?.[props.channelId ?? props.result?.channel?.id] ?? props.result?.channel;
        return blockedDm(channel, this.blocked) ? null : <Original {...props} />;
      });
    }
    this.api.patchComponent<Data>('DmsList', (Original) => (props) => {
      this.api.redux.usePatchVersion();
      const channels = this.api.redux.getRawState()?.channels;
      const channelIds = Array.isArray(props.channelIds)
        ? keep(props.channelIds, (id) => !blockedDm(channels?.[id], this.blocked))
        : props.channelIds;
      const dms = Array.isArray(props.dms)
        ? keep(props.dms, (result) => !blockedDm(channels?.[result.channel?.id] ?? result.channel, this.blocked))
        : props.dms;
      return <Original {...props} channelIds={channelIds} dms={dms} />;
    });
    this.api.patchComponent<Data>('PeopleGrid', (Original) => (props) => {
      this.api.redux.usePatchVersion();
      const users = Array.isArray(props.users)
        ? keep(props.users, (user) => !isBlocked(user.id, this.blocked))
        : props.users;
      return <Original {...props} users={users} />;
    });
    this.api.patchComponent<Data>('MessageFile', (Original) => (props) => {
      this.api.redux.usePatchVersion();
      return isBlocked(props.file?.user, this.blocked) ? null : <Original {...props} />;
    });
    // These avatars belong to the reply bar, not the huddle participant list.
    this.api.patchComponent<Data>('ReplyBarAvatar', (Original) => (props) => {
      this.api.redux.usePatchVersion();
      return isBlocked(props.userId, this.blocked) ? null : <Original {...props} />;
    });
  }

  private projectActivity(item: Data | undefined, state: Data): Data | undefined {
    if (!item || !isThreadActivity(item)) return item;
    const source = this.activitySources.get(item) ?? item;
    const messages = state.messages?.[source.channelId];
    const cached = this.activities.get(source);
    if (cached && cached.messages === messages) return cached.result;
    const result = filterThreadActivity(source, state, this.blocked);
    this.activities.set(source, { messages, result });
    if (result !== source) this.activitySources.set(result, source);
    return result;
  }

  // Preserve thunk metadata, receiver and sync/async return behavior at both call levels.
  private mapThunk(name: string, map: (result: any, args: any[]) => any) {
    this.api.redux.patchThunk(
      name,
      (original) =>
        function (this: unknown, ...args: any[]) {
          const thunk = original.apply(this, args);
          if (typeof thunk !== 'function') return thunk;
          return Object.assign(function (this: unknown, ...inner: unknown[]) {
            const result = thunk.apply(this, inner);
            return result && typeof result.then === 'function'
              ? result.then((r: unknown) => map(r, args))
              : map(result, args);
          }, thunk);
        },
    );
  }

  private patchAutocomplete() {
    // Omniswitcher owns its results. Keep menu/input and upstream selection aligned.
    this.api.patchComponent<Data>('SearchAutocomplete', (Original) => (props) => {
      this.api.redux.usePatchVersion();
      const view = React.useMemo(
        () => projectSuggestions(props.suggestions ?? [], props.selectedIndex, this.blocked),
        [props.suggestions, props.selectedIndex, this.blocked],
      );
      React.useLayoutEffect(() => {
        if (view.needsSync && view.nextSourceIndex != null)
          props.onSuggestionSelected({ selectedIndex: view.nextSourceIndex, setText: false });
      }, [view, props.onSuggestionSelected]);
      return (
        <Original
          {...props}
          suggestions={view.suggestions}
          selectedIndex={view.selectedIndex}
          onSuggestionSelected={(selection: Data) =>
            props.onSuggestionSelected({
              ...selection,
              selectedIndex: view.sourceIndex(selection.selectedIndex),
            })
          }
          onAccept={(...args: unknown[]) => view.canAccept && props.onAccept(...args)}
        />
      );
    });
    this.api.patchComponent<Data>('SearchInputBox', (Original) => (props) => {
      this.api.redux.usePatchVersion();
      const view = React.useMemo(
        () => projectSuggestions(props.suggestions ?? [], props.autocompleteSelectedIndex, this.blocked),
        [props.suggestions, props.autocompleteSelectedIndex, this.blocked],
      );
      return (
        <Original
          {...props}
          suggestions={view.suggestions}
          autocompleteSelectedIndex={view.selectedIndex}
          onEnter={(...args: unknown[]) => view.canAccept && props.onEnter(...args)}
        />
      );
    });
    const empty = new Set<string>();
    const filter = (result: unknown) => filterMemberResults(result, () => (this.api.isActive() ? this.blocked : empty));
    this.mapThunk('autocompleteMembers', filter);
    this.api.patchComponent<Data>('TextyAutocomplete', (Original) => (props) => {
      this.api.redux.usePatchVersion();
      const disallowedResults = React.useMemo(
        () => new Set([...(props.disallowedResults ?? []), ...this.blocked]),
        [props.disallowedResults, this.blocked],
      );
      const mentionMenuSeedResults = React.useMemo(
        () => filter(props.mentionMenuSeedResults),
        [props.mentionMenuSeedResults, this.blocked],
      );
      return (
        <Original {...props} disallowedResults={disallowedResults} mentionMenuSeedResults={mentionMenuSeedResults} />
      );
    });
  }

  private patchProfilePopups() {
    for (const name of ['MemberProfileHoverCard', 'ProfileHoverCard']) {
      this.api.patchComponent<Data>(name, (Original) => (props) => {
        this.api.redux.usePatchVersion();
        if (!isBlocked(props.memberId, this.blocked)) return <Original {...props} />;
        return (
          <div
            className="slick-betterblock-profile"
            style={{
              position: 'relative',
              overflow: 'hidden',
              borderRadius: 12,
              background: 'rgb(var(--sk_primary_background, 255, 255, 255))',
              boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.12), 0 8px 24px rgba(0, 0, 0, 0.16)',
            }}
          >
            <div
              aria-hidden="true"
              inert
              style={{ filter: 'blur(8px)', opacity: 0.65, pointerEvents: 'none', userSelect: 'none' }}
            >
              <Original {...props} />
            </div>
            <div
              role="status"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
                background: 'rgba(var(--sk_primary_background, 255, 255, 255), 0.3)',
                fontSize: 16,
                fontWeight: 700,
                textAlign: 'center',
                color: 'rgb(var(--sk_primary_foreground, 29, 28, 29))',
              }}
            >
              You blocked this person
            </div>
          </div>
        );
      });
    }
  }

  private patchNotifications() {
    const shouldHide = (args: unknown[]) => {
      const options = args[0];
      return record(options) && !options.options?.is_call_notification && hidesMessage(options.message, this.blocked);
    };
    for (const name of ['showNotification', 'showSavedItemNotification']) {
      this.api.redux.patchThunk(
        name,
        (original) =>
          function (this: unknown, ...args: unknown[]) {
            // Veto before Slack plays a sound, bounces the dock, or passes content
            // to the native app. Preserve the dispatchable thunk contract.
            return shouldHide(args) ? () => Promise.resolve() : original.apply(this, args);
          },
      );
    }
  }

  private menuItem(id: string): MenuTemplateItem | null {
    if (!/^[UW][A-Z0-9]{6,}$/.test(id) || id === this.api.members.getCurrentMemberId()) return null;
    const member = this.api.members.getCachedMember(id);
    const name =
      member?.profile?.display_name ||
      member?.profile?.real_name ||
      member?.real_name ||
      member?.name ||
      this.config.blockedUsers[id] ||
      id;
    return {
      key: MENU_KEY,
      label: `${this.config.blockedUsers[id] ? 'Unblock' : 'Block'} ${name}`,
      danger: !this.config.blockedUsers[id],
      click: () => {
        void this.toggleBlock(id);
      },
    };
  }

  private insertMenuItem(id: string, template: MenuTemplateItem[]): MenuTemplateItem[] {
    const item = this.menuItem(id);
    if (!item || template.some((entry) => entry.key === MENU_KEY)) return template;
    const anchor = template.findIndex((entry) => {
      const action = (entry as MenuTemplateItem & { autoClogProps?: { elementName?: string } }).autoClogProps
        ?.elementName;
      return (
        action === 'hide_user' ||
        action === 'unhide_user' ||
        (typeof entry.label === 'string' && /^(?:Hide|Unhide) /.test(entry.label))
      );
    });
    if (anchor !== -1) return [...template.slice(0, anchor + 1), item, ...template.slice(anchor + 1)];
    return [...template, { key: `${MENU_KEY}-separator`, type: 'separator' }, item];
  }

  private async toggleBlock(id: string) {
    if (!this.api.isActive() || id === this.api.members.getCurrentMemberId()) return;
    const next = { ...this.config.blockedUsers };
    if (next[id]) delete next[id];
    else {
      const member = this.api.members.getCachedMember(id);
      next[id] = (member?.profile?.display_name || member?.profile?.real_name || member?.real_name || id).slice(0, 100);
    }
    try {
      if (!(await this.api.settings.set('blockedUsers', next))) throw new Error('Settings were not saved');
    } catch (error) {
      this.log('Could not save the block list', error);
      if (this.api.isActive())
        void this.api.modal.alert({
          title: 'Could not save BetterBlock',
          body: 'Your block list was not changed. Please try again.',
        });
    }
  }

  private patchMenus() {
    this.api.patchComponent<{ memberId?: string }>('RimetoMemberProfileOverflowMenu', (Original) => (props) => (
      <this.ProfileContext.Provider value={props.memberId ?? null}>
        <Original {...props} />
      </this.ProfileContext.Provider>
    ));
    this.api.patchComponent<{ template?: MenuTemplateItem[] }>('MenuFromTemplate', (Original) => (props) => {
      const id = React.useContext(this.ProfileContext);
      this.api.redux.usePatchVersion();
      if (!id || !Array.isArray(props.template)) return <Original {...props} />;
      return <Original {...props} template={this.insertMenuItem(id, props.template)} />;
    });
    // Avatar context menus bypass the profile's MenuFromTemplate context.
    this.mapThunk('getMemberContextMenuTemplate', (template, [member]) =>
      this.api.isActive() && Array.isArray(template) ? this.insertMenuItem(member?.id, template) : template,
    );
  }
}
