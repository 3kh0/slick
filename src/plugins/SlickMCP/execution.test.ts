import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { executionScript } from './execution.ts';

function fixture(active = true) {
  const calls: unknown[] = [];
  const plugin = {
    api: { isActive: () => active },
    run: async (action: string, args: unknown) => {
      if (action === 'context') return { workspace_id: 'T1', user_id: 'U1' };
      calls.push({ action, args });
      return args;
    },
  };
  return {
    calls,
    context: { window: { __slickPluginManager: { plugins: new Map([['SlickMCP', { instance: plugin }]]) } } },
  };
}

test('execution transports text as data with HTML and JavaScript delimiters escaped', async () => {
  const args = {
    text: 'Quotes " and \' and backticks ` with ${literal}\n<markup>\u2028\u2029',
    nested: { values: [null, true, 42] },
  };
  const script = executionScript('api', args, { workspace_id: 'T1', user_id: 'U1' });
  const payload = script.match(/const \{action,args,scope\}=(.*);/)![1]!;
  assert.equal(/[<>\u2028\u2029]/.test(payload), false);
  const { context, calls } = fixture();
  const result = await runInNewContext(script, context);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), args);
  assert.equal(calls.length, 1);
});

test('evaluation code is passed to its explicit renderer action as data', async () => {
  const code = 'return await Promise.resolve({ value: "<sample>" });';
  const { context, calls } = fixture();
  await runInNewContext(executionScript('evaluate', { code }), context);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ action: 'evaluate', args: { code } }]);
});

test('disabled plugins and mismatched operation scopes cannot dispatch actions', async () => {
  const disabled = fixture(false);
  await assert.rejects(runInNewContext(executionScript('api', {}), disabled.context), /not ready/);
  assert.equal(disabled.calls.length, 0);
  const switched = fixture();
  await assert.rejects(
    runInNewContext(executionScript('api', {}, { workspace_id: 'T2', user_id: 'U1' }), switched.context),
    /Workspace changed/,
  );
  assert.equal(switched.calls.length, 0);
});

test('message attribution preserves content and adds one linked context footer', async () => {
  const { attributeMessage, MCP_ATTRIBUTION } = await import('./attribution.ts');
  for (const method of ['chat.postMessage', 'chat.postEphemeral', 'chat.scheduleMessage', 'chat.update']) {
    const input = { channel: 'CTEST', text: '*Hello* <@UTEST>', thread_ts: '1.000001' };
    const output = attributeMessage(method, input);
    assert.equal(output.text, input.text);
    assert.equal(output.thread_ts, input.thread_ts);
    assert.deepEqual(output.blocks[0], { type: 'section', text: { type: 'mrkdwn', text: input.text } });
    assert.deepEqual(output.blocks.at(-1), { type: 'context', elements: [{ type: 'mrkdwn', text: MCP_ATTRIBUTION }] });
    assert.deepEqual(attributeMessage(method, output), output);
    assert.equal('blocks' in input, false);
  }
});

test('attribution handles existing blocks, file comments, plaintext, and long Unicode text', async () => {
  const { attributeMessage, MCP_ATTRIBUTION } = await import('./attribution.ts');
  const block = { type: 'section', text: { type: 'mrkdwn', text: 'Keep this' } };
  const existing = attributeMessage('chat.postMessage', { blocks: JSON.stringify([block]) });
  assert.deepEqual(existing.blocks[0], block);
  const legacy = attributeMessage('chat.postMessage', {
    blocks: [{ type: 'context', elements: [{ type: 'mrkdwn', text: MCP_ATTRIBUTION.replaceAll('*', '') }] }],
  });
  assert.equal(legacy.blocks.length, 1);
  assert.equal(legacy.blocks[0].elements[0].text, MCP_ATTRIBUTION);
  const mixed = attributeMessage('chat.postMessage', {
    blocks: [
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: 'Other context' },
          { type: 'mrkdwn', text: MCP_ATTRIBUTION },
        ],
      },
    ],
  });
  assert.equal(mixed.blocks[0].elements[0].text, 'Other context');
  const upload = attributeMessage('files.completeUploadExternal', {
    channel_id: 'CTEST',
    initial_comment: 'File comment',
    files: [{ id: 'FTEST' }],
  });
  assert.equal('initial_comment' in upload, false);
  assert.equal(upload.blocks[0].text.text, 'File comment');
  assert.deepEqual(upload.files, [{ id: 'FTEST' }]);
  const privateUpload = { files: [{ id: 'FTEST' }] };
  assert.equal(attributeMessage('files.completeUploadExternal', privateUpload), privateUpload);
  const text = 'x'.repeat(2999) + '😀' + 'y'.repeat(5000);
  const long = attributeMessage('chat.postMessage', { text });
  assert.equal(
    long.blocks
      .slice(0, -1)
      .map((b: any) => b.text.text)
      .join(''),
    text,
  );
  assert.ok(
    long.blocks.slice(0, -1).every((b: any) => b.text.text.length <= 3000 && !/[\uD800-\uDBFF]$/.test(b.text.text)),
  );
  assert.equal(
    attributeMessage('chat.postMessage', { text: 'literal *text*', mrkdwn: false }).blocks[0].text.type,
    'plain_text',
  );
  assert.equal(attributeMessage('chat.postMessage', { text: 'visible', blocks: [] }).blocks[0].text.text, 'visible');
  assert.throws(
    () => attributeMessage('chat.postMessage', { blocks: Array.from({ length: 50 }, () => block) }),
    /50 message blocks/,
  );
  const unrelated = { channel: 'CTEST', ts: '1.000001' };
  assert.equal(attributeMessage('chat.delete', unrelated), unrelated);
  assert.equal(attributeMessage('chat.update', unrelated), unrelated);
});

test('tool policies validate saved names without enabling tools absent from the saved allowlist', async () => {
  const { toolNames } = await import('./toolAccess.ts');
  const tools = [{ name: 'slack_read_channel', description: '', readOnly: true }];
  assert.deepEqual(toolNames(['slack_read_channel', 'slack_read_channel', 'removed_tool'], tools), [
    'slack_read_channel',
  ]);
  assert.throws(() => toolNames('all', tools), /list of tool names/);
  assert.throws(() => toolNames([true], tools), /list of tool names/);
});

for (const mode of ['legacy', 'auto'] as const) {
  test(`MCP ${mode} hides disabled tools and rejects calls from a cached catalog`, async () => {
    const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
    const { startMcpServer } = await import('./server.ts');
    const denied = new Set<string>();
    const calls: string[] = [];
    const server = await startMcpServer(
      0,
      'x'.repeat(64),
      async (action) => {
        calls.push(action);
        return [];
      },
      undefined,
      { isToolEnabled: (name) => !denied.has(name) },
    );
    const clients: InstanceType<typeof Client>[] = [];
    const connect = async () => {
      const client = new Client({ name: 'test', version: '1' }, { versionNegotiation: { mode } });
      clients.push(client);
      await client.connect(
        new StreamableHTTPClientTransport(new URL(server.url), {
          requestInit: { headers: { Authorization: 'Bearer ' + 'x'.repeat(64) } },
        }),
      );
      assert.equal(client.getNegotiatedProtocolVersion()?.startsWith('2026'), mode === 'auto');
      return client;
    };
    try {
      const original = await connect();
      assert.ok((await original.listTools()).tools.some((tool) => tool.name === 'slack_send_message'));
      denied.add('slack_send_message');
      let blocked = false;
      try {
        const result = await original.callTool({
          name: 'slack_send_message',
          arguments: { channel: 'CTEST', text: 'must never post' },
        });
        blocked = result.isError === true;
      } catch (error) {
        blocked = /disabled|not found/i.test(String(error));
      }
      assert.equal(blocked, true);
      assert.deepEqual(calls, []);
      const fresh = await connect();
      const names = (await fresh.listTools()).tools.map((tool) => tool.name);
      assert.equal(names.includes('slack_send_message'), false);
      assert.ok(names.includes('slack_read_channel'));
      await assert.rejects(
        fresh.callTool({ name: 'slack_send_message', arguments: { channel: 'CTEST', text: 'must never post' } }),
      );
      assert.deepEqual(calls, []);
    } finally {
      await Promise.all(clients.map((client) => client.close()));
      await server.close();
    }
  });
}

test('agent setup prompts contain valid connection configuration and keep client setup instructions', async () => {
  const { connectionConfig } = await import('./connection.ts');
  const url = 'http://127.0.0.1:38465/mcp';
  const token = 'test-token-with-"quotes"';
  const json = connectionConfig(url, token, 'json');
  const prompt = connectionConfig(url, token, 'prompt');
  assert.ok(prompt.includes(json));
  assert.equal(JSON.parse(json).mcpServers.slick.headers.Authorization, `Bearer ${token}`);
  assert.match(prompt, /Keep the bearer token private/);
  assert.match(prompt, /wait for my instructions/);
  assert.match(connectionConfig(url, token, 'codex'), /\[mcp_servers.slick\]/);
});
