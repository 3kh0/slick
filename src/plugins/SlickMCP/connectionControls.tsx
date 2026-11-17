import type { ConnectionStatus } from './connection.ts';

type Props = {
  status: ConnectionStatus;
  action: (method: 'copy' | 'rotate', format?: 'json' | 'codex' | 'prompt') => Promise<unknown>;
};

export function ConnectionControls({ status, action }: Props) {
  const [notice, setNotice] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const act = async (method: 'copy' | 'rotate', format?: 'json' | 'codex' | 'prompt') => {
    setBusy(true);
    try {
      await action(method, format);
      setNotice(
        method === 'rotate'
          ? 'Connection token regenerated. Copy the new configuration to reconnect your agents.'
          : format === 'prompt'
            ? 'Setup prompt copied.'
            : 'Connection configuration copied.',
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="slick-mcp-connection" aria-label="Agent connection">
      <h3>Connect an agent</h3>
      <p className="slick-mcp-connection__status" data-state={status.state} role="status">
        {status.state === 'listening' ? (
          <>
            Listening at <code>{status.url}</code>
          </>
        ) : (
          (status.error ?? (status.state === 'stopped' ? 'Server stopped' : 'Starting the local server…'))
        )}
      </p>
      <p className="slick-settings__hint">
        Copy a setup prompt into your agent, or use a configuration for your MCP client. Copied text contains your
        private connection token.
      </p>
      <div className="slick-mcp-tools__toolbar">
        {(['prompt', 'json', 'codex'] as const).map((format) => (
          <button
            key={format}
            type="button"
            className={`c-button c-button--${format === 'prompt' ? 'primary' : 'outline'} c-button--small`}
            disabled={busy || status.state !== 'listening'}
            onClick={() => void act('copy', format)}
          >
            {format === 'prompt'
              ? 'Copy setup prompt'
              : format === 'json'
                ? 'Copy JSON configuration'
                : 'Copy Codex configuration'}
          </button>
        ))}
        <button
          type="button"
          className="c-button c-button--outline c-button--small"
          disabled={busy}
          onClick={() => void act('rotate')}
        >
          Regenerate connection token
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
