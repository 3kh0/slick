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
