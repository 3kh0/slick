import { toolGroup, type ToolAccessState } from './toolAccess.ts';

type Props = { state: ToolAccessState; save: (disabled: string[]) => Promise<void> };

export function ToolControls({ state, save }: Props) {
  const [query, setQuery] = React.useState('');
  const [disabled, setDisabled] = React.useState(state.disabled);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  React.useEffect(() => setDisabled(state.disabled), [state.disabled]);
  const hidden = new Set(disabled);
  const dirty = [...disabled].toSorted().join('\n') !== [...state.disabled].toSorted().join('\n');
  const visible = state.tools.filter((tool) =>
    `${tool.name} ${tool.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  const groups = ['Read and discover', 'Messages and actions', 'Advanced and desktop'];
  const apply = async () => {
    setBusy(true);
    setNotice('');
    try {
      await save(disabled);
      setNotice('Tool access saved. Reconnect your agent to refresh its tool list.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="slick-mcp-tools" aria-label="Exposed MCP tools">
      <h3>Exposed tools</h3>
      <p className="slick-settings__hint">
        Choose what agents can discover and call. Changes apply when saved. New tools stay off after you customize
        access.
      </p>
      {!state.tools.length ? (
        <p role="status">Loading tools…</p>
      ) : (
        <>
          <div className="slick-mcp-tools__toolbar">
            <div className="slick-mcp-tools__search">
              <svg
                className="slick-mcp-tools__search-icon"
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <circle cx="8.5" cy="8.5" r="5.5" />
                <path d="m13 13 4 4" />
              </svg>
              <input
                className="c-input_text"
                type="search"
                aria-label="Find an MCP tool"
                placeholder="Find a tool…"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && query) {
                    event.stopPropagation();
                    setQuery('');
                  }
                }}
              />
              {query && (
                <button
                  type="button"
                  className="slick-mcp-tools__clear"
                  aria-label="Clear tool search"
                  onClick={() => setQuery('')}
                >
                  ×
                </button>
              )}
            </div>
            <div className="slick-mcp-tools__presets" role="group" aria-label="Tool access presets">
              {(['All', 'Read-only', 'None'] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="c-button c-button--outline c-button--small"
                  disabled={busy}
                  onClick={() => {
                    setDisabled(
                      state.tools
                        .filter((tool) => preset === 'None' || (preset === 'Read-only' && !tool.readOnly))
                        .map((tool) => tool.name),
                    );
                    setNotice('');
                  }}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
          <p aria-live="polite">
            {state.tools.length - disabled.length} of {state.tools.length} tools exposed
            {dirty ? ' · Unsaved changes' : ''}
          </p>
          <p className="slick-settings__hint">
            API, JavaScript, and desktop controls can perform actions covered by other tools. Turn those off too when
            restricting actions.
          </p>
          <div className="slick-mcp-tools__list" tabIndex={0} role="region" aria-label="MCP tool list">
            {groups.map((group) => {
              const tools = visible.filter((tool) => toolGroup(tool) === group);
              if (!tools.length) return null;
              return (
                <details key={group} className="slick-mcp-tools__group" open>
                  <summary>
                    {group}{' '}
                    <span>
                      {tools.filter((tool) => !hidden.has(tool.name)).length}/{tools.length}
                    </span>
                  </summary>
                  {tools.map((tool) => (
                    <label key={tool.name} className="slick-mcp-tools__row">
                      <span>
                        <strong>{tool.name}</strong>
                        <span className="slick-mcp-tools__description">{tool.description}</span>
                      </span>
                      <span className="c-switch c-switch--small slick-settings__switch">
                        <input
                          className="c-switch__input"
                          type="checkbox"
                          role="switch"
                          aria-label={`Expose ${tool.name}`}
                          checked={!hidden.has(tool.name)}
                          disabled={busy}
                          onChange={(event) => {
                            const enabled = event.currentTarget.checked;
                            setDisabled((current) =>
                              enabled ? current.filter((name) => name !== tool.name) : [...current, tool.name],
                            );
                            setNotice('');
                          }}
                        />
                        <span className="c-switch__visual" />
                      </span>
                    </label>
                  ))}
                </details>
              );
            })}
            {!visible.length && <p>No matching tools.</p>}
          </div>
          <div className="slick-mcp-tools__toolbar">
            <button
              type="button"
              className="c-button c-button--primary c-button--small"
              disabled={!dirty || busy}
              onClick={() => void apply()}
            >
              {busy ? 'Saving…' : 'Save tool access'}
            </button>
            <button
              type="button"
              className="c-button c-button--outline c-button--small"
              disabled={!dirty || busy}
              onClick={() => {
                setDisabled(state.disabled);
                setNotice('');
              }}
            >
              Discard changes
            </button>
          </div>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
