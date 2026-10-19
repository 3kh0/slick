import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createThunkPatches } from '../slack/thunkPatches.ts';
import { setupMessageSendBlocks } from './messageSendBlocks.ts';

type Block = Record<string, unknown>;

function fixture(formatted?: Block[]) {
  const patches = createThunkPatches();
  const creator = (name: string) =>
    patches.wrapCreator(Object.assign((...args: unknown[]) => ({ name, args }), { meta: { name } }));
  const format = (args: unknown) => ({ name: 'blocksFormatFetcher', args });
  const formatCalls: unknown[] = [];
  const onMessageSendBlocks = setupMessageSendBlocks({
    patchThunk: patches.patch,
    getThunkCreator: (name: string) => (name === 'blocksFormatFetcher' && formatted ? format : undefined),
    waitForThunkCreator: () => new Promise(() => {}),
  });
  // What Slack's store would do: run thunks, answer the format call.
  const dispatch = async (action: any): Promise<any> => {
    if (typeof action === 'function') return action(dispatch);
    if (action?.name === 'blocksFormatFetcher') {
      formatCalls.push(action.args);
      return { blocks: formatted };
    }
    return action;
  };
  return {
    onMessageSendBlocks,
    dispatch,
    formatCalls,
    sendMessage: creator('sendMessage'),
    saveMessageEdit: creator('saveMessageEdit'),
    apiCall: creator('apiCall'),
  };
}

const text = (value: string): Block => ({
  type: 'rich_text',
  elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: value }] }],
});
const links = (...urls: string[]): Block => ({
  type: 'rich_text',
  elements: [{ type: 'rich_text_section', elements: urls.map((url) => ({ type: 'link', url })) }],
});
const shout = (blocks: Block[]) => blocks.map((block) => ({ ...block, shouted: true }));

test('sends carry transformed blocks for both the pending message and the wire', () => {
  const { onMessageSendBlocks, sendMessage } = fixture();
  const args = { channelId: 'C1', blocks: [text('hi')] };
  assert.equal(sendMessage(args).args[0], args);

  const remove = onMessageSendBlocks(shout);
  const sent = sendMessage(args).args[0];
  assert.deepEqual(sent.blocks, [{ ...text('hi'), shouted: true }]);
  assert.equal(sent.channelId, 'C1');
  assert.equal(args.blocks[0]!.shouted, undefined);

  remove();
  assert.equal(sendMessage(args).args[0], args);
});

test('a transform that throws or returns non-blocks is skipped, not sent', (t) => {
  const errors: unknown[] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => errors.push(args));
  const { onMessageSendBlocks, sendMessage } = fixture();
  onMessageSendBlocks(() => {
    throw new Error('broken');
  });
  onMessageSendBlocks(function returnsNothing() {
    return undefined as unknown as Block[];
  });
  onMessageSendBlocks(() => [null as unknown as Block]);
  onMessageSendBlocks(shout);

  const args = { blocks: [text('hi')] };
  assert.deepEqual(sendMessage(args).args[0].blocks, [{ ...text('hi'), shouted: true }]);
  assert.equal(errors.length, 3);
  assert.match(String((errors[1] as unknown[])[0]), /returnsNothing \(#\d+.*returned invalid blocks/);
});

test('each registration has its own disposer, even for the same function', () => {
  const { onMessageSendBlocks, sendMessage } = fixture();
  let runs = 0;
  const count = (blocks: Block[]) => {
    runs++;
    return blocks;
  };
  const first = onMessageSendBlocks(count);
  onMessageSendBlocks(count);
  first();
  sendMessage({ blocks: [text('hi')] });
  assert.equal(runs, 1);
});

test('unfurls follow rewritten links and markdown_text is dropped next to new blocks', () => {
  const { onMessageSendBlocks, sendMessage } = fixture();
  const link = (url: string): Block => ({
    type: 'rich_text',
    elements: [{ type: 'rich_text_section', elements: [{ type: 'link', url }] }],
  });
  onMessageSendBlocks((blocks) =>
    JSON.stringify(blocks).includes('old.example') ? [link('https://new.example/')] : blocks,
  );
  const sent = sendMessage({
    blocks: [link('https://old.example/')],
    markdown_text: 'https://old.example/',
    unfurl: JSON.stringify([
      { type: 'link', url: 'https://old.example/' },
      { type: 'link', url: 'https://x.test/' },
    ]),
  }).args[0];
  assert.deepEqual(JSON.parse(sent.unfurl), [
    { type: 'link', url: 'https://new.example/' },
    { type: 'link', url: 'https://x.test/' },
  ]);
  assert.equal('markdown_text' in sent, false);
});

test('markdown composer sends are converted to blocks before transforming', async () => {
  const { onMessageSendBlocks, sendMessage, dispatch, formatCalls } = fixture([text('**hi**')]);
  const args = { channelId: 'C1', markdown_text: '**hi**' };
  onMessageSendBlocks((blocks) => blocks);
  // Nothing changed, so Slack sends its own markdown.
  assert.deepEqual(await dispatch(sendMessage(args)), { name: 'sendMessage', args: [args] });

  onMessageSendBlocks(shout);
  const sent = await dispatch(sendMessage(args));
  assert.deepEqual(sent.args[0], { channelId: 'C1', blocks: [{ ...text('**hi**'), shouted: true }] });
  assert.deepEqual(JSON.parse((formatCalls[1] as { blocks: string }).blocks), [{ type: 'markdown', text: '**hi**' }]);
});

test('removing a link also removes its unfurl request', () => {
  const { onMessageSendBlocks, sendMessage } = fixture();
  const url = 'https://private.example/secret';
  onMessageSendBlocks(() => [text('redacted')]);
  const sent = sendMessage({
    blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'link', url }] }] }],
    unfurl: JSON.stringify([{ type: 'link', url }]),
  }).args[0];
  assert.deepEqual(JSON.parse(sent.unfurl), []);
});

test('removing and reordering links preserves the remaining preview metadata', () => {
  const { onMessageSendBlocks, sendMessage } = fixture();
  const urls = ['https://a.example/', 'https://b.example/', 'https://c.example/'];
  const unfurl = urls.map((url, id) => ({ type: 'link', url, id }));
  const remove = onMessageSendBlocks(() => [links(urls[2]!, urls[0]!)]);
  assert.deepEqual(sendMessage({ blocks: [links(...urls)], unfurl }).args[0].unfurl, [unfurl[0], unfurl[2]]);
  remove();
  onMessageSendBlocks(() => [links(...urls.toReversed())]);
  assert.deepEqual(sendMessage({ blocks: [links(...urls)], unfurl }).args[0].unfurl, unfurl);
});

test('markdown sends go out untouched when Slack cannot format them', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { onMessageSendBlocks, sendMessage, dispatch } = fixture();
  onMessageSendBlocks(shout);
  const args = { markdown_text: 'hi' };
  // getThunkCreator misses and the wait is bounded.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const result = dispatch(sendMessage(args));
  await Promise.resolve();
  t.mock.timers.tick(5_000);
  assert.deepEqual(await result, { name: 'sendMessage', args: [args] });
});

test('wire calls transform JSON blocks, and drafts only once scheduled', () => {
  const { onMessageSendBlocks, apiCall } = fixture();
  onMessageSendBlocks(shout);
  const blocks = JSON.stringify([text('hi')]);

  const update = apiCall({ method: 'chat.update', args: { ts: '1.2', blocks } }).args[0];
  assert.deepEqual(JSON.parse(update.args.blocks), [{ ...text('hi'), shouted: true }]);
  assert.equal(update.args.ts, '1.2');

  const draft = { method: 'drafts.update', args: { blocks } };
  assert.equal(apiCall(draft).args[0], draft);
  const scheduled = apiCall({ method: 'drafts.update', args: { blocks, date_scheduled: 1 } }).args[0];
  assert.equal(JSON.parse(scheduled.args.blocks)[0].shouted, true);

  const other = { method: 'conversations.history', args: { blocks } };
  assert.equal(apiCall(other).args[0], other);
  const attachment = apiCall({ method: 'files.completeUploadExternal', args: { blocks } }).args[0];
  assert.equal(JSON.parse(attachment.args.blocks)[0].shouted, true);

  const malformed = { method: 'chat.postMessage', args: { blocks: '[1]' } };
  assert.equal(apiCall(malformed).args[0], malformed);
});

test('markdown composer edits are converted at the wire', async () => {
  const { onMessageSendBlocks, apiCall, dispatch } = fixture([text('_hi_')]);
  onMessageSendBlocks(shout);
  const sent = await dispatch(apiCall({ method: 'chat.update', args: { ts: '1.2', markdown_text: '_hi_' } }));
  assert.deepEqual(sent.args[0].args, {
    ts: '1.2',
    blocks: JSON.stringify([{ ...text('_hi_'), shouted: true }]),
  });
});

test('edits transform only what the thunk dispatches synchronously', async () => {
  const patches = createThunkPatches();
  const onMessageSendBlocks = setupMessageSendBlocks({
    patchThunk: patches.patch,
    getThunkCreator: () => undefined,
    waitForThunkCreator: () => new Promise(() => {}),
  });
  const edit = { ts: '1.2', channelId: 'C1', blocks: [text('hi')] };
  const saveMessageEdit = patches.wrapCreator(
    Object.assign(
      () => async (dispatch: (action: unknown) => unknown) => {
        dispatch({ type: 'optimistic', payload: edit });
        await Promise.resolve();
        dispatch({ type: 'later', payload: edit });
      },
      { meta: { name: 'saveMessageEdit' } },
    ),
  );
  onMessageSendBlocks(shout);
  const dispatched: any[] = [];
  await saveMessageEdit()((action: unknown) => dispatched.push(action));
  assert.equal(dispatched[0].payload.blocks[0].shouted, true);
  assert.equal(dispatched[0].payload.ts, '1.2');
  assert.equal(dispatched[1].payload, edit);
});
