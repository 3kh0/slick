import { SlickPlugin } from '$slick';
import { getActiveTeam, readLocalConfig } from '../../app/slack/localConfig.ts';
import type { ConnectionStatus } from './connection.ts';
import * as meta from './meta.ts';
import { AgentFeatures, rendererActions } from './renderer.ts';

export default class SlickMCP extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly requiredAPIs = ['redux', 'rtm'] as const;
  static readonly liveSettings = ['port'] as const;

  private status = new this.api.Store<ConnectionStatus>({ state: 'starting', url: '', error: null });
  private refs = new Map<string, HTMLElement>();
  private snapshot = 0;
  private features = new AgentFeatures(this.api);

  start() {
    this.api.setStyle(`
      .slick-mcp-settings { display: flex; flex-direction: column; gap: 18px; max-width: 760px; }
      .slick-mcp-settings p { margin: 0; line-height: 1.5; }
      .slick-mcp-settings h3 { margin: 6px 0 -8px; font-size: 15px; }
      .slick-mcp-settings code { user-select: all; }
    `);
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
      const params = Object.fromEntries(
        Object.entries(args.params ?? {})
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
    const [notice, setNotice] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const act = async (method: string, format?: string) => {
      setBusy(true);
      try {
        const result = await this.api.main.call<ConnectionStatus | boolean>(method, ...(format ? [format] : []));
        if (method === 'rotate') this.status.set(result as ConnectionStatus);
        setNotice(
          method === 'copy'
            ? 'Connection configuration copied.'
            : 'Connection token regenerated. Copy the new configuration to reconnect your agents.',
        );
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    };
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
        <p role="status">
          {status.state === 'listening' ? (
            <>
              Listening at <code>{status.url}</code>
            </>
          ) : (
            (status.error ?? 'Starting the local server…')
          )}
        </p>
        <p className="slick-settings__hint">
          Copy the configuration into your agent’s MCP settings, then restart or reconnect the client. Slick must stay
          open. The token is saved privately on this computer.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            className="c-button c-button--primary c-button--small"
            disabled={busy || status.state !== 'listening'}
            onClick={() => void act('copy', 'json')}
          >
            Copy JSON configuration
          </button>
          <button
            className="c-button c-button--outline c-button--small"
            disabled={busy || status.state !== 'listening'}
            onClick={() => void act('copy', 'codex')}
          >
            Copy Codex configuration
          </button>
          <button
            className="c-button c-button--outline c-button--small"
            disabled={busy}
            onClick={() => void act('rotate')}
          >
            Regenerate connection token
          </button>
        </div>
        {notice && <p role="status">{notice}</p>}
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
