export type AgentTool = { name: string; description: string; readOnly: boolean };
export type ToolAccessState = { tools: AgentTool[]; disabled: string[] };

export function toolNames(value: unknown, tools: readonly AgentTool[]): string[] {
  if (!Array.isArray(value) || value.some((name) => typeof name !== 'string'))
    throw new Error('Tool access must be a list of tool names');
  const known = new Set(tools.map((tool) => tool.name));
  return [...new Set(value as string[])].filter((name) => known.has(name)).toSorted();
}

export function toolGroup(tool: AgentTool): string {
  if (
    /^slack_(api|evaluate|dispatch_action|find_actions|read_ui|click|type|keypress|hover|scroll|screenshot|open)$/.test(
      tool.name,
    )
  )
    return 'Advanced and desktop';
  return tool.readOnly ? 'Read and discover' : 'Messages and actions';
}
