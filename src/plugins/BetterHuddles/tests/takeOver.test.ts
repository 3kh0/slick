import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { closePreparedWindows, TAKEN_OVER_THUNKS, takeOverRequest } from '../takeOver.ts';

describe('takeOverRequest', () => {
  it('takes over huddles in channels, private channels, DMs and group DMs', () => {
    for (const channelId of ['C06V73WGACB', 'G0123ABCD', 'D0ABCDEF1']) {
      assert.deepEqual(takeOverRequest({ channelId, entryPoint: 'channel_header' }), { channelId, muted: false });
    }
  });

  it('keeps the muted flag Slack asked for', () => {
    assert.deepEqual(takeOverRequest({ channelId: 'C1234', muted: true }), { channelId: 'C1234', muted: true });
  });

  it('leaves standalone huddles and malformed calls to Slack', () => {
    assert.equal(takeOverRequest({ channelId: 'C1234', isStandaloneHuddle: true }), null);
    assert.equal(takeOverRequest({ channelId: '' }), null);
    assert.equal(takeOverRequest({ channelId: 'U1234' }), null);
    assert.equal(takeOverRequest({ channelId: 'C1234&token=x' }), null);
    assert.equal(takeOverRequest(undefined), null);
    assert.equal(takeOverRequest('C1234'), null);
  });
});

describe('TAKEN_OVER_THUNKS', () => {
  it('includes the confirmation thunk the header button dispatches, ahead of startHuddle', () => {
    assert.ok(TAKEN_OVER_THUNKS.includes('startHuddleWithConfirmation'));
    assert.ok(TAKEN_OVER_THUNKS.indexOf('startHuddleWithConfirmation') < TAKEN_OVER_THUNKS.indexOf('startHuddle'));
  });
});

describe('closePreparedWindows', () => {
  const fakeWindow = () => {
    const opened = { closed: false, close: () => (opened.closed = true) };
    return opened;
  };

  it('closes the windows Slack opened ahead of the dispatch', () => {
    const huddleWindow = fakeWindow();
    const previewWindow = fakeWindow();
    closePreparedWindows({
      channelId: 'C1234',
      windowRef: { deref: () => huddleWindow },
      previewWindowRef: { deref: () => previewWindow },
    });
    assert.equal(huddleWindow.closed, true);
    assert.equal(previewWindow.closed, true);
  });

  it('ignores missing, collected or malformed refs', () => {
    assert.doesNotThrow(() => closePreparedWindows(undefined));
    assert.doesNotThrow(() => closePreparedWindows({ channelId: 'C1234' }));
    assert.doesNotThrow(() => closePreparedWindows({ windowRef: { deref: () => undefined } }));
    assert.doesNotThrow(() => closePreparedWindows({ windowRef: 'nope', previewWindowRef: {} }));
  });

  it('keeps going when a window refuses to close', () => {
    const previewWindow = fakeWindow();
    const throwing = {
      close: () => {
        throw new Error('blocked');
      },
    };
    closePreparedWindows({ windowRef: { deref: () => throwing }, previewWindowRef: { deref: () => previewWindow } });
    assert.equal(previewWindow.closed, true);
  });
});
