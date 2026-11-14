export type ConnectionStatus = {
  state: 'stopped' | 'starting' | 'listening' | 'error';
  url: string;
  error: string | null;
};

export function connectionConfig(url: string, token: string, format: 'json' | 'codex'): string {
  if (format === 'codex') {
    return `[mcp_servers.slick]\nurl = ${JSON.stringify(url)}\nhttp_headers = { Authorization = ${JSON.stringify(`Bearer ${token}`)} }\n`;
  }
  return JSON.stringify(
    { mcpServers: { slick: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } },
    null,
    2,
  );
}
