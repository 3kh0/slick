import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NOT_ENROLLED,
  applyOverride,
  buildCatalog,
  matches,
  normalizeQuery,
  sanitizeOverrides,
  scanSource,
  type CodeRefs,
} from './catalog.ts';

const SOURCE =
  'zIjs(e,t,n){var l=n("QSkg"),c=n("ulrH");let a={' +
  'ZV:e=>"on"===(0,l._Z)(e,"reskin_custom_responses"),' +
  'Zq:e=>(0,l.ze)(e,"channel_tabs_v5")==="treatment_b",' +
  'Zr:e=>"control"!==(0,l._Z)(e,"channel_tabs_v5",!1),' +
  'Zs:e=>(0,l.KK)(e,"desktop_ui_simplification")?.group,' +
  'Zt:e=>(0,c._Z)(e,"not_an_experiment")}}';

const scan = (source: string) => {
  const refs: CodeRefs = new Map();
  scanSource(source, 'QSkg', ['KK', '_Z', 'ze'], refs);
  return refs;
};

test('scanSource: finds names and the groups they are compared with', () => {
  const refs = scan(SOURCE);
  assert.deepEqual([...refs.keys()].toSorted(), [
    'channel_tabs_v5',
    'desktop_ui_simplification',
    'reskin_custom_responses',
  ]);
  assert.deepEqual([...refs.get('reskin_custom_responses')!], ['on']);
  assert.deepEqual([...refs.get('channel_tabs_v5')!].toSorted(), ['control', 'treatment_b']);
  assert.deepEqual([...refs.get('desktop_ui_simplification')!], []);
});

test('scanSource: ignores modules that do not import the selectors', () => {
  assert.equal(scan('x(e,t,n){var l=n("OTHER");(0,l._Z)(e,"nope")}').size, 0);
});

test('scanSource: numeric module ids', () => {
  const refs: CodeRefs = new Map();
  scanSource('m(e,t,n){var r=n(4656);"on"===(0,r.$a)(e,"x_y")}', '4656', ['$a'], refs);
  assert.deepEqual([...refs.keys()], ['x_y']);
});

test('applyOverride: swaps the group and stops exposure logging', () => {
  const assignment = { experiment_id: '1', type: 'team', group: 'control', trigger: 'hash_team', log_exposures: true };
  assert.deepEqual(applyOverride(assignment, 'treatment'), { ...assignment, group: 'treatment', log_exposures: false });
  assert.equal(applyOverride(assignment, undefined), assignment);
  assert.equal(applyOverride(assignment, NOT_ENROLLED), undefined);
});

test('applyOverride: synthesizes an assignment the server never sent', () => {
  assert.deepEqual(applyOverride(undefined, 'on'), {
    experiment_id: 'from-override',
    type: 'user',
    exposure_id: 0,
    trigger: 'force_request',
    group: 'on',
    log_exposures: false,
  });
});

test('sanitizeOverrides: drops malformed entries', () => {
  assert.deepEqual(sanitizeOverrides({ ok_name: 'on', 'bad name': 'on', empty: '', num: 1, long: 'x'.repeat(101) }), {
    ok_name: 'on',
  });
  assert.deepEqual(sanitizeOverrides(null), {});
  assert.deepEqual(sanitizeOverrides(['on']), {});
});

test('buildCatalog: merges assignments, code refs and overrides, sorted', () => {
  const catalog = buildCatalog({ b_assigned: { group: 'treatment_a' } }, new Map([['a_code', new Set(['variant'])]]), {
    c_forced: 'custom',
  });
  assert.deepEqual(
    catalog.map((e) => [e.name, e.inCode, e.override, e.groups]),
    [
      ['a_code', true, undefined, ['variant', 'on', 'off', 'control', 'treatment']],
      ['b_assigned', false, undefined, ['treatment_a', 'on', 'off', 'control', 'treatment']],
      ['c_forced', false, 'custom', ['custom', 'on', 'off', 'control', 'treatment']],
    ],
  );
});

test('matches: query and filters', () => {
  const catalog = buildCatalog({ channel_tabs_v5: { group: 'on' } }, new Map([['activity_inbox', new Set<string>()]]), {
    zz_forced: 'on',
  });
  const [code, assigned, forced] = ['activity_inbox', 'channel_tabs_v5', 'zz_forced'].map((name) =>
    catalog.find((e) => e.name === name)!,
  );
  assert.equal(matches(assigned, normalizeQuery(' Channel Tabs '), 'all'), true);
  assert.equal(matches(code, normalizeQuery('channel tabs'), 'all'), false);
  assert.equal(matches(code, '', 'unassigned'), true);
  assert.equal(matches(assigned, '', 'unassigned'), false);
  assert.equal(matches(assigned, '', 'assigned'), true);
  assert.equal(matches(forced, '', 'overridden'), true);
  assert.equal(matches(assigned, '', 'overridden'), false);
});
