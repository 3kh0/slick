import { SlickPlugin } from '$slick';
import { getActiveTeam, readLocalConfig } from '../../app/slack/localConfig.ts';
import type { ConnectionStatus } from './connection.ts';
import * as meta from './meta.ts';
import { AgentFeatures, rendererActions } from './renderer.ts';
import { attributeMessage } from './attribution.ts';
import { ToolControls } from './toolControls.tsx';
import { ConnectionControls } from './connectionControls.tsx';
import type { ToolAccessState } from './toolAccess.ts';

export default class SlickMCP extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly requiredAPIs = ['redux', 'rtm'] as const;
  static readonly liveSettings = ['port', 'messageAttribution'] as const;

  private status = new this.api.Store<ConnectionStatus>({ state: 'starting', url: '', error: null });
  private toolAccess = new this.api.Store<ToolAccessState>({ tools: [], disabled: [] });
  private refs = new Map<string, HTMLElement>();
  private snapshot = 0;
  private features = new AgentFeatures(this.api);

  start() {
    this.api.setStyle(`
      .slick-mcp-settings { display: flex; flex-direction: column; gap: 18px; max-width: 760px; }
      .slick-mcp-settings p { margin: 0; line-height: 1.5; }
      .slick-mcp-settings h3 { margin: 6px 0 -8px; font-size: 15px; }
      .slick-mcp-settings code { user-select: all; }
      .slick-mcp-customize, .slick-mcp-connection { display: flex; flex-direction: column; gap: 12px; }
      .slick-mcp-customize { padding: 16px; gap: 24px; }
      .slick-mcp-customize h3, .slick-mcp-customize p, .slick-mcp-connection h3, .slick-mcp-connection p { margin: 0; }
      .slick-mcp-connection__status { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
      .slick-mcp-connection__status::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--dt_color-content-ter, #888); }
      .slick-mcp-connection__status[data-state="listening"]::before { background: var(--dt_color-content-positive, #2bac76); }
      .slick-mcp-connection__status[data-state="error"]::before { background: var(--dt_color-content-negative, #e55); }
      .slick-mcp-tools { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
      .slick-mcp-tools h3, .slick-mcp-tools p { margin: 0; }
      .slick-mcp-tools__toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
      .slick-mcp-tools__search { position: relative; flex: 1 1 240px; min-width: 180px; }
      .slick-mcp-tools__search .c-input_text { width: 100%; height: 38px; margin: 0; padding: 8px 34px; border: 1px solid var(--dt_color-otl-sec, #555); border-radius: 8px; background: var(--dt_color-base-pry, transparent); color: var(--dt_color-content-pry, inherit); font: inherit; appearance: none; }
      .slick-mcp-tools__search .c-input_text::placeholder { color: var(--dt_color-content-ter, #888); }
      .slick-mcp-tools__search .c-input_text::-webkit-search-cancel-button { appearance: none; }
      .slick-mcp-tools__search-icon { position: absolute; width: 18px; height: 18px; top: 10px; left: 11px; color: var(--dt_color-content-ter, #888); pointer-events: none; }
      .slick-mcp-tools__clear { position: absolute; right: 7px; top: 5px; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 5px; background: none; color: var(--dt_color-content-sec, inherit); font-size: 22px; cursor: pointer; }
      .slick-mcp-tools__clear:hover { background: var(--dt_color-base-sec, #222); }
      .slick-mcp-tools__presets { display: flex; gap: 6px; flex-wrap: wrap; }
      .slick-mcp-tools__list { display: block; flex: 0 0 auto; max-height: 420px; overflow-y: auto; overscroll-behavior-y: contain; scrollbar-gutter: stable; }
      .slick-mcp-tools__group + .slick-mcp-tools__group { margin-top: 10px; }
      .slick-mcp-tools__group { border: 1px solid var(--sk_foreground_low, #444); border-radius: 8px; overflow: hidden; }
      .slick-mcp-tools__group summary { cursor: pointer; padding: 12px 14px; font-weight: 700; }
      .slick-mcp-tools__group summary span { font-weight: 400; margin-left: 8px; color: var(--sk_foreground_max_solid, #aaa); }
      .slick-mcp-tools__row { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 12px 14px; border-top: 1px solid var(--sk_foreground_low, #444); cursor: pointer; }
      .slick-mcp-tools__row > span:first-child { min-width: 0; overflow-wrap: anywhere; }
      .slick-mcp-tools__row .c-switch { flex-shrink: 0; }
      .slick-mcp-tools__description { display: block; margin-top: 4px; font-size: 13px; line-height: 1.4; color: var(--sk_foreground_max_solid, #aaa); }
    `);
    this.api.settings.panel(() => <this.Customize />);
    this.api.main.on('tools', (state) => this.toolAccess.set(state as ToolAccessState));
    void this.api.main
      .call<ToolAccessState>('tools')
      .then((state) => {
        if (this.api.isActive()) this.toolAccess.set(state);
      })
      .catch(() => {});
    this.api.main.on('status', (status) => this.status.set(status as ConnectionStatus));
    void this.api.main
      .call<ConnectionStatus>('status')
      .then((status) => {
        if (this.api.isActive()) this.status.set(status);
      })
      .catch((error) => {
        if (this.api.isActive()) this.status.set({ state: 'error', url: '', error: String(error) });
      });
    this.api.settings.addTab({ label: 'Slick MCP', icon: 'code', render: () => <this.Panel /> });
  }

  private Customize = () => {
    const status = this.status.use();
    const tools = this.toolAccess.use();
    return (
      <div className="slick-mcp-customize">
        <ConnectionControls status={status} action={this.connectionAction} />
        <ToolControls state={tools} save={this.saveTools} />
      </div>
    );
  };

  private connectionAction = async (method: 'copy' | 'rotate', format?: 'json' | 'codex' | 'prompt') => {
    const result = await this.api.main.call<ConnectionStatus | boolean>(method, ...(format ? [format] : []));
    if (method === 'rotate') this.status.set(result as ConnectionStatus);
    return result;
  };

  private saveTools = async (disabled: string[]) => {
    const state = await this.api.main.call<ToolAccessState>('setTools', disabled);
    if (this.api.isActive()) this.toolAccess.set(state);
  };

  stop() {
    this.features.stop();
    this.refs.clear();
  }

  async run(action: string, args: Record<string, any>) {
    if (!this.api.isActive()) throw new Error('Slick MCP is disabled');
    if (rendererActions.has(action)) return this.features.run(action, args);
    if (action === 'context') {
      const team = getActiveTeam();
      return {
        workspace_id: team?.id,
        user_id: team?.user_id,
        workspaces: Object.values(readLocalConfig().teams ?? {}).map(({ id, user_id, name, domain }) => ({
          id,
          user_id,
          name,
          domain,
        })),
      };
    }
    if (action === 'evaluate') {
      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
      return new AsyncFunction('api', 'redux', 'document', 'window', String(args.code))(
        this.api,
        this.api.redux,
        document,
        window,
      );
    }
    if (action === 'api') {
      const outgoing = this.config.messageAttribution
        ? attributeMessage(args.method, args.params ?? {})
        : (args.params ?? {});
      const params = Object.fromEntries(
        Object.entries(outgoing)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]),
      );
      return this.api.userAPI(args.method, params, {
        signal: AbortSignal.any([this.api.signal, AbortSignal.timeout(30_000)]),
      });
    }
    if (action === 'open') return this.api.redux.dispatchThunk('handleDeepLink', { uri: args.uri });
    if (action === 'find_actions')
      return this.api.redux
        .thunkNames()
        .filter((name) => name.toLowerCase().includes(args.query.toLowerCase()))
        .slice(0, 200);
    if (action === 'dispatch_action') return this.api.redux.dispatchThunk(args.name, args.args);
    if (action === 'read_ui') {
      const root = document.querySelector<HTMLElement>(args.selector);
      if (!root) throw new Error('Snapshot root not found');
      this.refs.clear();
      const snapshot = ++this.snapshot;
      const nodes = [
        ...root.querySelectorAll<HTMLElement>(
          'a, button, input, textarea, select, [role="button"], [role="tab"], [role="combobox"], [contenteditable="true"]',
        ),
      ];
      const elements = nodes
        .filter(
          (node) =>
            node.getClientRects().length &&
            getComputedStyle(node).visibility !== 'hidden' &&
            !node.closest('[aria-hidden="true"]'),
        )
        .slice(0, args.limit)
        .map((node, index) => {
          const ref = `e${snapshot}-${index + 1}`;
          this.refs.set(ref, node);
          return {
            ref,
            tag: node.tagName.toLowerCase(),
            role: node.getAttribute('role'),
            label: (node.getAttribute('aria-label') || node.innerText || node.getAttribute('placeholder') || '').slice(
              0,
              160,
            ),
            ...((node instanceof HTMLInputElement && !['password', 'hidden'].includes(node.type)) ||
            node instanceof HTMLTextAreaElement
              ? { value: node.value.slice(0, 2000) }
              : {}),
            disabled: node.matches(':disabled, [aria-disabled="true"]'),
          };
        });
      return { url: location.href, text: root.innerText.slice(0, 60_000), elements };
    }
    const node = args.target
      ? (this.refs.get(args.target) ?? document.querySelector<HTMLElement>(args.target))
      : action === 'scroll'
        ? (document.scrollingElement as HTMLElement)
        : null;
    if (!node?.isConnected) throw new Error('Element no longer exists. Read the UI again.');
    node.scrollIntoView({ block: 'nearest' });
    if (action === 'scroll') {
      let scroller = node;
      while (scroller !== document.scrollingElement) {
        const style = getComputedStyle(scroller);
        if (
          (args.delta_y &&
            scroller.scrollHeight > scroller.clientHeight &&
            /auto|scroll|overlay/.test(style.overflowY)) ||
          (args.delta_x && scroller.scrollWidth > scroller.clientWidth && /auto|scroll|overlay/.test(style.overflowX))
        )
          break;
        scroller = scroller.parentElement ?? (document.scrollingElement as HTMLElement);
      }
      scroller.scrollBy({ left: args.delta_x, top: args.delta_y, behavior: 'instant' });
      return {
        scroll_left: scroller.scrollLeft,
        scroll_top: scroller.scrollTop,
        scroll_width: scroller.scrollWidth,
        scroll_height: scroller.scrollHeight,
        client_width: scroller.clientWidth,
        client_height: scroller.clientHeight,
      };
    }
    if (action === 'bounds') {
      const rect = node.getBoundingClientRect();
      const x = Math.max(0, rect.left),
        y = Math.max(0, rect.top);
      const width = Math.min(innerWidth, rect.right) - x,
        height = Math.min(innerHeight, rect.bottom) - y;
      if (width <= 0 || height <= 0) throw new Error('Screenshot target is not visible');
      return { x, y, width, height };
    }
    if (action === 'locate') {
      const rect = node.getBoundingClientRect();
      const left = Math.max(0, rect.left),
        right = Math.min(innerWidth, rect.right);
      const top = Math.max(0, rect.top),
        bottom = Math.min(innerHeight, rect.bottom);
      if (right <= left || bottom <= top || node.matches(':disabled, [aria-disabled="true"]'))
        throw new Error('Element is not visible or enabled');
      const point = { x: (left + right) / 2, y: (top + bottom) / 2 };
      if (!node.contains(document.elementFromPoint(point.x, point.y)))
        throw new Error('Element is covered. Read the UI again.');
      return point;
    }
    if (action === 'type') {
      node.focus();
      const editor = node.matches('.ql-editor') ? node : node.querySelector<HTMLElement>('.ql-editor');
      const quill = (editor?.parentElement as (HTMLElement & { __quill?: any }) | null)?.__quill;
      if (quill) {
        if (args.append) quill.insertText(quill.getLength() - 1, args.text, 'user');
        else quill.setText(args.text, 'user');
        quill.focus();
        return { typed: true };
      }
      if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
        if (node instanceof HTMLInputElement && node.type === 'file')
          throw new Error('Use Slack file upload tools for files');
        const value = (args.append ? node.value : '') + args.text;
        const prototype = node instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value);
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
        return { typed: true };
      }
      throw new Error('Target is not a supported text field');
    }
    throw new Error(`Unknown desktop action: ${action}`);
  }

  private Panel = () => {
    const status = this.status.use();
    const tools = this.toolAccess.use();
    return (
      <div className="slick-settings slick-mcp-settings">
        <h2 className="slick-settings__title">Slick MCP</h2>
        <p className="slick-settings__subtitle">
          Connect an agent to this desktop app to search Slack, read threads, manage messages, and use the Slack UI as
          you.
        </p>
        <p className="slick-settings__hint">
          Connected agents can read private conversations and send or delete content as you. Only connect clients you
          trust. Turn off Slick MCP to disconnect them.
        </p>
        <ConnectionControls status={status} action={this.connectionAction} />
        <ToolControls state={tools} save={this.saveTools} />
        <h3>Available to your agent</h3>
        <p>
          Search messages and files; read channels, threads, profiles, and reactions; send, schedule, edit, or delete
          messages; manage reactions; open DMs; create channels and canvases; and upload files.
        </p>
        <p>
          Catch up on unreads, Activity, and Later; prepare drafts; wait for new replies; transfer files; set your
          status or focus period; and configure Slick plugins.
        </p>
        <p>
          Advanced tools provide other Slack API methods, named Slack actions, and desktop UI inspection, clicking,
          typing, keyboard shortcuts, and JavaScript.
        </p>
        <p>
          Change the local server port in this plugin’s settings. Regenerating the token revokes the old configuration.
        </p>
      </div>
    );
  };
}
