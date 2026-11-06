import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recentPlaces, searchPlaces, type PickerPlace } from './picker.ts';

const snapshot = (id: string, ts: number, teamId = 'T1') => ({
  teamId,
  ts,
  activeTab: 'home',
  home: { primary: { id, viewType: 'Channel' } },
});

test('native recents use the active view, workspace and visit time instead of alphabetical order', () => {
  const history = [snapshot('C1', 1), snapshot('D2', 3), snapshot('C1', 2), snapshot('C3', 10, 'T2'), null];
  assert.deepEqual(recentPlaces(history, 'T1'), [{ channel: 'D2' }, { channel: 'C1' }]);
  assert.deepEqual(recentPlaces(null, 'T1'), []);
});

test('recent thread destinations stay distinct and malformed records are ignored', () => {
  const history = [
    {
      teamId: 'T1',
      ts: 5,
      activeTab: 'dms',
      home: { primary: { id: 'C9', viewType: 'Channel' } },
      dms: { primary: { viewType: 'Thread', params: { threadId: 'C1-1770000000.123456' } } },
    },
    snapshot('C1', 2),
    snapshot('javascript:bad', 9),
    {},
  ];
  assert.deepEqual(recentPlaces(history, 'T1'), [{ channel: 'C1', thread: '1770000000.123456' }, { channel: 'C1' }]);
});

const places: PickerPlace[] = [
  { tab: { channel: 'D1' }, label: 'Zoë Scott', searchText: 'scooter', recent: true },
  { tab: { channel: 'C2' }, label: 'general', recent: true },
  { tab: { channel: 'C2' }, label: 'general' },
  { tab: { channel: 'C3' }, label: 'general-help' },
  { tab: { channel: 'C4' }, label: 'a-general' },
];

test('opening the picker shows deduplicated recent places in visit order', () => {
  assert.deepEqual(
    searchPlaces(places, '').map((p) => p.tab.channel),
    ['D1', 'C2'],
  );
});

test('search ranks exact and prefix matches before substring matches', () => {
  assert.deepEqual(
    searchPlaces(places, '#GENERAL').map((p) => p.tab.channel),
    ['C2', 'C3', 'C4'],
  );
});

test('search supports names, handles, accents, and words in any order', () => {
  assert.equal(searchPlaces(places, 'scott zoe')[0]?.tab.channel, 'D1');
  assert.equal(searchPlaces(places, '@scooter')[0]?.tab.channel, 'D1');
  assert.deepEqual(searchPlaces(places, 'not found'), []);
});

test('users without native history can browse cached conversations', () => {
  assert.deepEqual(
    searchPlaces(
      places.filter((p) => !p.recent),
      '',
    ).map((p) => p.tab.channel),
    ['C4', 'C2', 'C3'],
  );
});
