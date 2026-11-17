export type ConnectionStatus = {
  state: 'stopped' | 'starting' | 'listening' | 'error';
  url: string;
  error: string | null;
};

export function connectionConfig(url: string, token: string, format: 'json' | 'codex' | 'prompt'): string {
  if (format === 'codex') {
    return `[mcp_servers.slick]\nurl = ${JSON.stringify(url)}\nhttp_headers = { Authorization = ${JSON.stringify(`Bearer ${token}`)} }\n`;
  }
  const json = JSON.stringify(
    { mcpServers: { slick: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } },
    null,
    2,
  );
  if (format === 'prompt')
    return `Connect my agent to the local Slick MCP server using the HTTP MCP configuration below. Keep the bearer token private; do not post it to Slack or include it in logs. If your client needs a restart to load MCP configuration, tell me. Once connected, confirm which tools are exposed, then wait for my instructions before changing anything in Slack. Respect the tools I have enabled in Slick.

${json}
`;
  return json;
}
