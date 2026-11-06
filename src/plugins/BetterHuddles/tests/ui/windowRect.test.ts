import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clampWindowRect,
  defaultWindowRect,
  MIN_WINDOW_SIZE,
  moveWindowRect,
  parseWindowRect,
  resizeWindowFromEdge,
} from '../../ui/windowRect.ts';

const viewport = { width: 1440, height: 900 };

describe('defaultWindowRect', () => {
  it('opens in the bottom-right corner, inside the page', () => {
    const rect = defaultWindowRect(viewport);
    assert.equal(rect.left + rect.width, viewport.width - 24);
    assert.equal(rect.top + rect.height, viewport.height - 24);
  });

  it('never goes below the minimum size on a small page', () => {
    const rect = defaultWindowRect({ width: 400, height: 300 });
    assert.ok(rect.width >= MIN_WINDOW_SIZE.width && rect.height >= MIN_WINDOW_SIZE.height);
  });
});

describe('moveWindowRect', () => {
  it('moves by the pointer delta', () => {
    const moved = moveWindowRect({ left: 100, top: 100, width: 400, height: 300 }, 50, -20, viewport);
    assert.deepEqual(moved, { left: 150, top: 80, width: 400, height: 300 });
  });

  it('keeps the header on screen so the window can be grabbed again', () => {
    const offRight = moveWindowRect({ left: 100, top: 100, width: 400, height: 300 }, 5000, 5000, viewport);
    assert.ok(offRight.left <= viewport.width - 48 && offRight.top <= viewport.height - 48);
    const offTop = moveWindowRect({ left: 100, top: 100, width: 400, height: 300 }, -5000, -5000, viewport);
    assert.equal(offTop.top, 0);
    assert.ok(offTop.left + offTop.width >= 48);
  });
});

describe('resizeWindowFromEdge', () => {
  const rect = { left: 400, top: 300, width: 400, height: 300 };

  it('grows from the bottom-right corner but not past the page or under the minimum', () => {
    const grown = resizeWindowFromEdge({ left: 0, top: 0, width: 400, height: 300 }, 'se', 5000, 5000, viewport);
    assert.equal(grown.width, viewport.width);
    assert.equal(grown.height, viewport.height);
    const shrunk = resizeWindowFromEdge({ left: 0, top: 0, width: 400, height: 300 }, 'se', -5000, -5000, viewport);
    assert.deepEqual([shrunk.width, shrunk.height], [MIN_WINDOW_SIZE.width, MIN_WINDOW_SIZE.height]);
  });

  it('dragging the left or top edge keeps the opposite edge where it was', () => {
    const wider = resizeWindowFromEdge(rect, 'w', -100, 0, viewport);
    assert.deepEqual(wider, { left: 300, top: 300, width: 500, height: 300 });
    const taller = resizeWindowFromEdge(rect, 'n', 0, -50, viewport);
    assert.deepEqual(taller, { left: 400, top: 250, width: 400, height: 350 });
  });

  it('a side only changes its own axis', () => {
    assert.deepEqual(resizeWindowFromEdge(rect, 'e', 40, 999, viewport), { ...rect, width: 440 });
    assert.deepEqual(resizeWindowFromEdge(rect, 's', 999, 40, viewport), { ...rect, height: 340 });
  });

  it('a corner changes both axes', () => {
    assert.deepEqual(resizeWindowFromEdge(rect, 'nw', -10, -20, viewport), {
      left: 390,
      top: 280,
      width: 410,
      height: 320,
    });
  });

  it('shrinking from the left stops at the minimum width without moving the right edge', () => {
    const shrunk = resizeWindowFromEdge(rect, 'w', 5000, 0, viewport);
    assert.equal(shrunk.width, MIN_WINDOW_SIZE.width);
    assert.equal(shrunk.left + shrunk.width, rect.left + rect.width);
  });

  it('stops at the page edge', () => {
    const toTop = resizeWindowFromEdge(rect, 'n', 0, -5000, viewport);
    assert.equal(toTop.top, 0);
    assert.equal(toTop.top + toTop.height, rect.top + rect.height);
    const toRight = resizeWindowFromEdge(rect, 'e', 5000, 0, viewport);
    assert.equal(toRight.left + toRight.width, viewport.width);
  });
});

describe('parseWindowRect', () => {
  it('restores a saved rect, clamped to the current page', () => {
    assert.deepEqual(parseWindowRect({ left: 10, top: 20, width: 500, height: 400 }, viewport), {
      left: 10,
      top: 20,
      width: 500,
      height: 400,
    });
    assert.deepEqual(
      parseWindowRect({ left: 10, top: 20, width: 9000, height: 400 }, viewport),
      clampWindowRect({ left: 10, top: 20, width: 9000, height: 400 }, viewport),
    );
  });

  it('falls back to the default for missing or malformed data', () => {
    for (const saved of [null, 'x', { left: 1 }, { left: 'a', top: 0, width: 1, height: 1 }]) {
      assert.deepEqual(parseWindowRect(saved, viewport), defaultWindowRect(viewport));
    }
  });
});
