import { app, BrowserWindow, clipboard } from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import type { SlickMainPlugin } from '$slick';
import { serialQueue } from '../../shared/queue.ts';
import { connectionConfig, type ConnectionStatus } from './connection.ts';
import { executionScript } from './execution.ts';
import { id } from './meta.ts';
import { toolNames, type AgentTool, type ToolAccessState } from './toolAccess.ts';

let status: ConnectionStatus = { state: 'stopped', url: '', error: null };
let token = '';
let toolAccess: ToolAccessState | undefined;
let configureTools: ((value: unknown) => Promise<ToolAccessState>) | undefined;
let rotate: (() => Promise<void>) | undefined;

function clients() {
  return BrowserWindow.getAllWindows().filter((window) => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return false;
    try {
      const url = new URL(window.webContents.getURL());
      return url.origin === 'https://app.slack.com' && /^\/client(?:\/|$)/.test(url.pathname);
    } catch {
      return false;
    }
  });
}

function selectWindow(windowId: unknown) {
  const windows = clients();
  const selected =
    windowId === undefined
      ? (windows.find((window) => window.isFocused()) ?? windows[0])
      : windows.find((window) => window.id === windowId);
  if (!selected) throw new Error('No matching Slack window. Open a signed-in workspace in Slick first.');
  return selected;
}

function execute(
  window: Electron.BrowserWindow,
  action: string,
  args: Record<string, unknown>,
  scope?: import('./tools.ts').OperationScope,
) {
  return window.webContents.executeJavaScript(executionScript(action, args, scope), true);
}

export default {
  id,
  capabilities: ['net', 'secrets'],
  async ready(ctx) {
    const { startMcpServer } = await import('./server.ts');
    const { downloadSlackFile, uploadSlackFile } = await import('./transfers.ts');
    const { OperationStore } = await import('./operations.ts');
    const { createAgentServer } = await import('./tools.ts');
    const operations = await OperationStore.load(ctx.storage);
    const catalog: AgentTool[] = [];
    const catalogServer = await createAgentServer(async () => null, operations, {
      onTool: (tool) => catalog.push(tool),
    });
    await catalogServer.close();
    const saved = await ctx.storage.read('enabled-tools');
    const allowed = saved ? new Set(toolNames(JSON.parse(saved), catalog)) : null;
    let disabled = new Set(catalog.filter((tool) => allowed && !allowed.has(tool.name)).map((tool) => tool.name));
    toolAccess = { tools: catalog, disabled: [...disabled] };
    const enqueue = serialQueue();
    const controller = new AbortController();
    let current: Awaited<ReturnType<typeof startMcpServer>> | undefined;
    let disposed = false;
    const publish = () => ctx.emit('status', status);
    const start = async () => {
      await current?.close();
      current = undefined;
      if (disposed) return;
      status = { state: 'starting', url: '', error: null };
      publish();
      try {
        current = await startMcpServer(
          Math.trunc(Number(ctx.settings.port)),
          token,
          async (action, args, signal, scope) => {
            if (disposed || !ctx.settings.enabled || signal.aborted) throw new Error('Slick MCP is disconnected');
            const requestId = randomUUID();
            let target: Electron.BrowserWindow | undefined;
            const aborted = AbortSignal.any([
              signal,
              controller.signal,
              AbortSignal.timeout(action === 'download_file' || action === 'upload_file' ? 120_000 : 30_000),
            ]);
            const operation = async () => {
              if (action === 'workspaces') {
                const windows = args.window_id === undefined ? clients() : [selectWindow(args.window_id)];
                return Promise.all(
                  windows.map(async (window) => {
                    const base = { window_id: window.id, focused: window.isFocused() };
                    try {
                      return { ...base, ready: true, ...(await execute(window, 'context', {})) };
                    } catch {
                      return { ...base, ready: false };
                    }
                  }),
                );
              }
              const window = selectWindow(args.window_id);
              target = window;
              if (action === 'wait_for_event') return execute(window, action, { ...args, request_id: requestId });
              if (action === 'download_file') {
                const info = await execute(window, 'download_info', args);
                return {
                  file: info.id,
                  name: info.name,
                  mimetype: info.mimetype,
                  ...(await downloadSlackFile(
                    info,
                    String(args.destination),
                    (url, init) => window.webContents.session.fetch(url, init),
                    aborted,
                  )),
                };
              }
              if (action === 'upload_file') {
                return uploadSlackFile(
                  String(args.path),
                  args,
                  (method, params) => execute(window, 'api', { method, params }, scope),
                  (url, init) => window.webContents.session.fetch(url, init),
                  aborted,
                );
              }
              if (action === 'screenshot') {
                const bounds = args.target ? await execute(window, 'bounds', args) : undefined;
                const zoom = window.webContents.getZoomFactor();
                const rect = bounds
                  ? {
                      x: Math.floor(bounds.x * zoom),
                      y: Math.floor(bounds.y * zoom),
                      width: Math.ceil(bounds.width * zoom),
                      height: Math.ceil(bounds.height * zoom),
                    }
                  : undefined;
                let image = await window.webContents.capturePage(rect);
                if (image.isEmpty()) throw new Error('Slack could not capture this window');
                if (image.getSize().width > Number(args.max_width))
                  image = image.resize({ width: Number(args.max_width) });
                return { __slickImage: true, data: image.toPNG().toString('base64') };
              }
              if (action === 'click' || action === 'keypress' || action === 'hover') {
                window.show();
                app.focus({ steal: true });
                window.focus();
                window.webContents.focus();
              }
              if (action === 'click' || action === 'hover') {
                const point = await execute(window, 'locate', args, scope);
                const zoom = window.webContents.getZoomFactor();
                const position = { x: Math.round(point.x * zoom), y: Math.round(point.y * zoom) };
                window.webContents.sendInputEvent({ type: 'mouseMove', ...position });
                if (action === 'hover') return { hovered: true };
                window.webContents.sendInputEvent({ type: 'mouseDown', ...position, button: 'left', clickCount: 1 });
                window.webContents.sendInputEvent({ type: 'mouseUp', ...position, button: 'left', clickCount: 1 });
                return { clicked: true };
              }
              if (action === 'keypress') {
                if (scope) await execute(window, 'context', {}, scope);
                const input = {
                  keyCode: String(args.key),
                  modifiers: args.modifiers as Electron.KeyboardInputEvent['modifiers'],
                };
                window.webContents.sendInputEvent({ type: 'keyDown', ...input });
                window.webContents.sendInputEvent({ type: 'keyUp', ...input });
                return { pressed: args.key };
              }
              return execute(window, action, args, scope);
            };
            return new Promise((resolve, reject) => {
              const abort = () => {
                if (action === 'wait_for_event' && target && !target.isDestroyed())
                  void execute(target, 'cancel_wait', { request_id: requestId }).catch(() => {});
                reject(new Error('Operation interrupted or timed out. Check Slack before retrying a write.'));
              };
              aborted.addEventListener('abort', abort, { once: true });
              if (aborted.aborted) abort();
              else
                void operation()
                  .then(resolve, reject)
                  .finally(() => aborted.removeEventListener('abort', abort));
            });
          },
          operations,
          { isToolEnabled: (name) => !disabled.has(name) },
        );
        status = { state: 'listening', url: current.url, error: null };
      } catch (error) {
        status = { state: 'error', url: '', error: error instanceof Error ? error.message : String(error) };
      }
      publish();
    };
    token = (await ctx.secrets.read('connection-token')) ?? '';
    const renew = async () => {
      const next = randomBytes(32).toString('hex');
      if (!(await ctx.secrets.write('connection-token', next))) throw new Error('Could not save the connection token');
      token = next;
    };
    if (!token) await renew();
    rotate = () =>
      enqueue(async () => {
        await renew();
        await start();
      });
    configureTools = (value) =>
      enqueue(async () => {
        const next = toolNames(value, catalog);
        if (
          !(await ctx.storage.write(
            'enabled-tools',
            JSON.stringify(catalog.filter((tool) => !next.includes(tool.name)).map((tool) => tool.name)),
          ))
        )
          throw new Error('Could not save tool access');
        disabled = new Set(next);
        toolAccess = { tools: catalog, disabled: next };
        ctx.emit('tools', toolAccess);
        await start();
        return toolAccess;
      });
    ctx.emit('tools', toolAccess);
    let port = ctx.settings.port;
    const removeSettings = ctx.onSettingsChange((settings) => {
      if (settings.port === port) return;
      port = settings.port;
      void enqueue(start);
    });
    await enqueue(start);
    return async () => {
      disposed = true;
      controller.abort();
      removeSettings();
      rotate = undefined;
      configureTools = undefined;
      toolAccess = undefined;
      await enqueue(async () => {
        await current?.close();
        current = undefined;
        token = '';
        status = { state: 'stopped', url: '', error: null };
        publish();
      });
    };
  },
  rpc: {
    tools() {
      return toolAccess ?? { tools: [], disabled: [] };
    },
    async setTools(_ctx, [disabled]) {
      if (!configureTools) throw new Error('Slick MCP is not running');
      return configureTools(disabled);
    },
    status() {
      return status;
    },
    async rotate() {
      if (!rotate) throw new Error('Slick MCP is not running');
      await rotate();
      return status;
    },
    copy(_ctx, [format]) {
      if (status.state !== 'listening') throw new Error('Slick MCP is not listening');
      if (format !== 'json' && format !== 'codex') throw new Error('Unknown connection format');
      clipboard.writeText(connectionConfig(status.url, token, format));
      return true;
    },
  },
} satisfies SlickMainPlugin;
