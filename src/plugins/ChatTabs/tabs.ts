export type ChatTab = { channel: string; thread?: string };
export const MAX_TABS = 50;
const channelPattern = /^[CDG][A-Z0-9]+$/;
const threadPattern = /^\d{10,}\.\d{6}$/;

export function tabKey(tab: ChatTab): string {
  return `${tab.channel}:${tab.thread ?? ''}`;
}

export function readTab(path: string): ChatTab | null {
  const url = new URL(path, 'https://app.slack.com');
  const match = /^\/client\/[A-Z0-9]+\/([CDG][A-Z0-9]+)(?:\/|$)/.exec(url.pathname);
  if (!match) return null;
  const thread = url.searchParams.get('thread_ts') ?? url.pathname.match(/\/thread\/[CDG][A-Z0-9]+-(\d+\.\d{6})/)?.[1];
  return { channel: match[1]!, ...(thread && threadPattern.test(thread) ? { thread } : {}) };
}

export function currentThread(state: any, channel: string | undefined): string | undefined {
  const activeTab = state?.window?.main?.activeTab;
  if (!channel || typeof activeTab !== 'string') return;
  const view = state.view?.[`v2::main::${activeTab}::secondary`];
  if (view?.viewType !== 'Thread' || typeof view.params?.threadId !== 'string') return;
  const prefix = `${channel}-`;
  const id = view.params.threadId;
  if (id.startsWith(prefix) && threadPattern.test(id.slice(prefix.length))) return id.slice(prefix.length);
}

export function restoreTabs(value: unknown): ChatTab[] {
  if (!Array.isArray(value)) return [];
  const tabs: ChatTab[] = [];
  const keys = new Set<string>();
  for (const item of value) {
    if (!item || typeof item.channel !== 'string' || !channelPattern.test(item.channel)) continue;
    if (item.thread !== undefined && (typeof item.thread !== 'string' || !threadPattern.test(item.thread))) continue;
    const tab: ChatTab = { channel: item.channel, ...(item.thread ? { thread: item.thread } : {}) };
    if (keys.has(tabKey(tab))) continue;
    keys.add(tabKey(tab));
    tabs.push(tab);
    if (tabs.length === MAX_TABS) break;
  }
  return tabs;
}

export function visitTab(tabs: ChatTab[], tab: ChatTab): ChatTab[] {
  if (tabs.some((entry) => tabKey(entry) === tabKey(tab))) return tabs;
  return [...tabs.slice(-(MAX_TABS - 1)), tab];
}

export function closeTab(tabs: ChatTab[], key: string, active: string | undefined) {
  const index = tabs.findIndex((tab) => tabKey(tab) === key);
  if (index < 0 || tabs.length === 1) return { tabs, next: undefined };
  const remaining = tabs.filter((tab) => tabKey(tab) !== key);
  return { tabs: remaining, next: key === active ? remaining[Math.min(index, remaining.length - 1)] : undefined };
}

export function tabUri(team: string, tab: ChatTab): string {
  const params = new URLSearchParams({ team, id: tab.channel });
  if (tab.thread) params.set('thread_ts', tab.thread);
  return `slack://channel?${params}`;
}

export function moveTab(tabs: ChatTab[], source: string, target: string, after = false): ChatTab[] {
  if (source === target) return tabs;
  const moving = tabs.find((tab) => tabKey(tab) === source);
  if (!moving || !tabs.some((tab) => tabKey(tab) === target)) return tabs;
  const remaining = tabs.filter((tab) => tabKey(tab) !== source);
  const index = remaining.findIndex((tab) => tabKey(tab) === target) + (after ? 1 : 0);
  remaining.splice(index, 0, moving);
  return remaining.every((tab, i) => tab === tabs[i]) ? tabs : remaining;
}

export function splitProps(tab: ChatTab) {
  return tab.thread
    ? { id: 'thread', viewType: 'Thread', params: { threadId: `${tab.channel}-${tab.thread}`, highlightRoot: true } }
    : { id: tab.channel, viewType: 'Channel' };
}

export function currentTab(path: string, state: any): ChatTab | null {
  const active = state?.window?.main?.activeTab;
  const primary = typeof active === 'string' ? state.view?.[`v2::main::${active}::primary`] : undefined;
  if (primary?.viewType === 'Thread') {
    const match = /^([CDG][A-Z0-9]+)-(\d{10,}\.\d{6})$/.exec(primary.params?.threadId ?? '');
    if (match) return { channel: match[1]!, thread: match[2]! };
  }
  const routed =
    primary?.viewType === 'Channel' && channelPattern.test(primary.id)
      ? { channel: primary.id as string }
      : readTab(path);
  if (!routed) return null;
  const thread = currentThread(state, routed.channel);
  return thread ? { ...routed, thread } : routed;
}

export function threadTabForMessage(channel: unknown, ts: unknown, threadTs: unknown, state: any): ChatTab | null {
  if (typeof channel !== 'string' || !channelPattern.test(channel) || typeof ts !== 'string') return null;
  const root = state?.messages?.[channel]?.[ts]?.thread_ts || threadTs || ts;
  return typeof root === 'string' && threadPattern.test(root) ? { channel, thread: root } : null;
}

export function dragScrollSpeed(x: number, left: number, right: number): number {
  const edge = Math.min(40, (right - left) / 3);
  if (edge <= 0 || x < left || x > right) return 0;
  if (x < left + edge) return -Math.ceil(14 * (1 - (x - left) / edge));
  if (x > right - edge) return Math.ceil(14 * (1 - (right - x) / edge));
  return 0;
}
