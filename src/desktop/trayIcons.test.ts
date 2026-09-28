import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trayStateOf } from './trayIcons.ts';

function slackTray(dot?: [number, number, number], bgra = false): Uint8Array {
  const out = new Uint8Array(22 * 22 * 4);
  for (let y = 0; y < 22; y += 1) {
    for (let x = 0; x < 22; x += 1) {
      const i = (y * 22 + x) * 4;
      const inDot = dot && x >= 13 && y >= 13;
      const [r, g, b] = inDot ? dot : [255, 255, 255];
      out.set(bgra ? [b, g, r, 255] : [r, g, b, 255], i);
      if (!inDot && (x + y) % 3 === 0) out[i + 3] = 0;
    }
  }
  return out;
}

const UNREAD: [number, number, number] = [0, 208, 246];
const HIGHLIGHT: [number, number, number] = [244, 53, 122];

test('trayStateOf reads Slack tray dots in either byte order', () => {
  for (const bgra of [false, true]) {
    assert.equal(trayStateOf(slackTray(undefined, bgra)), 'rest');
    assert.equal(trayStateOf(slackTray(UNREAD, bgra)), 'unread');
    assert.equal(trayStateOf(slackTray(HIGHLIGHT, bgra)), 'highlight');
  }
});

test('trayStateOf ignores a few stray coloured pixels', () => {
  const image = slackTray();
  image.set([244, 53, 122, 255], 0);
  assert.equal(trayStateOf(image), 'rest');
  assert.equal(trayStateOf(new Uint8Array(0)), 'rest');
});
