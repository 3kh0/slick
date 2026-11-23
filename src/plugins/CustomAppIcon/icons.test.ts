import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeIcon, ICON_PAIRS, iconLabel, ICONS, pairFor } from './icons.ts';

test('ICON_PAIRS covers every pair in ICONS in matching order', () => {
  assert.equal(ICONS.length, ICON_PAIRS.length * 2);
  ICON_PAIRS.forEach((pair, index) => {
    assert.equal(ICONS[index * 2].id, pair.light);
    assert.equal(ICONS[index * 2 + 1].id, pair.dark);
  });
});

test('pairFor resolves both light and dark icons to their pair and returns null for custom or unknown IDs', () => {
  assert.equal(pairFor('slick')?.id, 'slick');
  assert.equal(pairFor('inverted')?.id, 'slick');
  assert.equal(pairFor('slack')?.id, 'slack');
  assert.equal(pairFor('slack-inverted')?.id, 'slack');
  assert.equal(pairFor('pride')?.id, 'pride');
  assert.equal(pairFor('pride-inverted')?.id, 'pride');
  assert.equal(pairFor('custom'), null);
  assert.equal(pairFor('unknown'), null);
  assert.equal(pairFor('toString'), null);
});

test('activeIcon keeps manual icons when autoInvert is off and normal/inverted by theme when on', () => {
  for (const icon of [...ICONS.map((entry) => entry.id), 'custom']) {
    assert.equal(activeIcon(icon, false, false), icon);
    assert.equal(activeIcon(icon, false, true), icon);
  }
  for (const pair of ICON_PAIRS) {
    assert.equal(activeIcon(pair.light, true, false), pair.light);
    assert.equal(activeIcon(pair.dark, true, false), pair.light);
    assert.equal(activeIcon(pair.light, true, true), pair.dark);
    assert.equal(activeIcon(pair.dark, true, true), pair.dark);
  }
  assert.equal(activeIcon('custom', true, false), 'custom');
  assert.equal(activeIcon('custom', true, true), 'custom');
});

test('iconLabel returns human-readable labels for built-in icons', () => {
  assert.equal(iconLabel('slick'), 'Slick');
  assert.equal(iconLabel('inverted'), 'Slick Inverted');
  assert.equal(iconLabel('slack'), 'Slack');
  assert.equal(iconLabel('slack-inverted'), 'Slack Inverted');
  assert.equal(iconLabel('pride'), 'Pride');
  assert.equal(iconLabel('pride-inverted'), 'Pride Inverted');
});
