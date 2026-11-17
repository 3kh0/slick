export const MCP_ATTRIBUTION = 'Sent via <https://slickclient.net/|SlickMCP>';
const messageMethods = new Set(['chat.postMessage', 'chat.postEphemeral', 'chat.scheduleMessage', 'chat.update']);

function textBlocks(text: string, plain: boolean): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  let remaining = text;
  while (remaining) {
    let end = Math.min(3000, remaining.length);
    if (end < remaining.length && /[\uD800-\uDBFF]/.test(remaining[end - 1]!)) end--;
    blocks.push({ type: 'section', text: { type: plain ? 'plain_text' : 'mrkdwn', text: remaining.slice(0, end) } });
    remaining = remaining.slice(end);
  }
  return blocks;
}

export function attributeMessage(method: string, params: Record<string, any>): Record<string, any> {
  const upload = method === 'files.completeUploadExternal';
  if (!upload && !messageMethods.has(method)) return params;
  if (upload && !params.channel_id && !params.channels) return params;
  if (
    method === 'chat.update' &&
    params.text === undefined &&
    params.blocks === undefined &&
    params.markdown_text === undefined
  )
    return params;
  const result = { ...params };
  let blocks: Record<string, any>[];
  if (params.blocks !== undefined) {
    const parsed = typeof params.blocks === 'string' ? JSON.parse(params.blocks) : params.blocks;
    if (!Array.isArray(parsed) || parsed.some((block) => !block || typeof block !== 'object'))
      throw new Error('Message blocks must be an array');
    blocks = parsed.flatMap((block) => {
      if (block.type !== 'context' || !Array.isArray(block.elements)) return [block];
      const elements = block.elements.filter((element: any) => element.text !== MCP_ATTRIBUTION);
      return elements.length ? [{ ...block, elements }] : [];
    });
  } else if (typeof params.markdown_text === 'string') {
    blocks = [{ type: 'markdown', text: params.markdown_text }];
    delete result.markdown_text;
  } else {
    const text = upload ? params.initial_comment : params.text;
    blocks = textBlocks(
      typeof text === 'string' ? text : '',
      params.mrkdwn === false || params.mrkdwn === 'false' || params.parse === 'full',
    );
  }
  if (!blocks.length && typeof (upload ? params.initial_comment : params.text) === 'string') {
    blocks = textBlocks(
      upload ? params.initial_comment : params.text,
      params.mrkdwn === false || params.mrkdwn === 'false' || params.parse === 'full',
    );
  }
  if (blocks.length >= 50) throw new Error('Leave one of Slack’s 50 message blocks available for SlickMCP attribution');
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: MCP_ATTRIBUTION }] });
  result.blocks = blocks;
  if (upload) delete result.initial_comment;
  return result;
}
