// Browser-only microbenchmark. The runner supplies the baseline implementation
// from its chosen Git revision and the implementation in the working tree.
// Sheets are synthetic and detached: this measures CSSOM comparison CPU, not
// Slack startup, frame rate, or total application memory.
type Compare = (a: CSSRuleList, b: CSSRuleList) => Generator<void, string | null>;

function verifyCSSOM(compare: Compare) {
  const cases: [string, string, string, string | null][] = [
    ['same declaration', '.a { color: red; }', '.a { color: red; }', ''],
    ['different declaration', '.a { color: red; }', '.a { color: blue; }', null],
    ['different media', '@media screen { .a {} }', '@media print { .a {} }', null],
    ['different supports', '@supports (display: flex) { .a {} }', '@supports (display: grid) { .a {} }', null],
    ['different container name', '@container a (width > 1px) { .a {} }', '@container b (width > 1px) { .a {} }', null],
    ['named layer', '@layer slack { .a {} }', '@layer slack { .a {} }', '@layer slack;'],
    ['anonymous layer', '@layer { .a {} }', '@layer { .a {} }', null],
    [
      'layer in media',
      '@media screen { @layer slack; .a {} }',
      '@media screen { @layer slack; .a {} }',
      '@media screen { @layer slack; }',
    ],
    [
      'brace inside condition',
      '@supports (--label: "{") { @layer slack; }',
      '@supports (--label: "{") { @layer slack; }',
      '@supports (--label: "{") { @layer slack; }',
    ],
    ['nested selector', '.a { color: red; & .b { color: blue; } }', '.a { color: red; & .b { color: blue; } }', ''],
    [
      'declaration following nesting',
      '.a { color: red; & .b { color: blue; } color: green; }',
      '.a { color: red; & .b { color: blue; } color: green; }',
      '',
    ],
    [
      'different nested declaration',
      '.a { color: red; & .b { color: blue; } }',
      '.a { color: red; & .b { color: green; } }',
      null,
    ],
    ['different animation', '@keyframes a { from { opacity: 0; } }', '@keyframes b { from { opacity: 0; } }', null],
  ];
  for (const [name, left, right, expected] of cases) {
    const a = new CSSStyleSheet();
    const b = new CSSStyleSheet();
    a.replaceSync(left);
    b.replaceSync(right);
    if (!a.cssRules.length || !b.cssRules.length) throw new Error(`Browser did not parse correctness fixture: ${name}`);
    const work = compare(a.cssRules, b.cssRules);
    let result = work.next();
    while (!result.done) result = work.next();
    if (result.value !== expected)
      throw new Error(
        `CSSOM correctness failure (${name}): expected ${JSON.stringify(expected)}, got ${JSON.stringify(result.value)}`,
      );
  }
  return cases.length;
}

export function benchmarkDuplicateStyles(before: Compare, after: Compare, ruleCount = 10_000, samples = 15) {
  const correctnessChecks = verifyCSSOM(after);
  const leaves = Array.from(
    { length: ruleCount },
    (_, i) =>
      `.message-${i} { color: rgb(${i % 255}, 20, 30); padding: 4px 8px; margin: 0; display: flex; align-items: center; border: 1px solid transparent; }`,
  ).join('\n');
  const conditional = `@media screen { @supports (display: flex) { @container messages (width > 1px) { @starting-style { @media (min-width: 1px) { ${leaves} } } } } }`;
  const nested = `.workspace { color: red; .channel { padding: 4px; .messages { display: flex; .thread { margin: 0; ${leaves} } } } }`;
  const fixtures = [
    ['flat', leaves],
    ['media', `@media screen { ${leaves} }`],
    ['nested-conditions', conditional],
    ['nested-selectors', nested],
  ] as const;
  const summarize = (values: number[]) => {
    const ordered = values.toSorted((a, b) => a - b);
    return { medianMs: ordered[Math.floor(ordered.length / 2)], p95Ms: ordered[Math.ceil(ordered.length * 0.95) - 1] };
  };
  const results = [];
  for (const [fixture, css] of fixtures) {
    const a = new CSSStyleSheet();
    const b = new CSSStyleSheet();
    a.replaceSync(css);
    b.replaceSync(css);
    const compare = (fn: Compare) => {
      const work = fn(a.cssRules, b.cssRules);
      const start = performance.now();
      let result = work.next();
      const firstYieldMs = performance.now() - start;
      while (!result.done) result = work.next();
      const totalMs = performance.now() - start;
      if (result.value !== '') throw new Error(`Unexpected comparison result for ${fixture}: ${result.value}`);
      return { totalMs, firstYieldMs };
    };
    // Warm both paths, then alternate their order to reduce scheduling/JIT bias.
    for (let i = 0; i < 3; i++) {
      compare(before);
      compare(after);
    }
    const prior = [];
    const current = [];
    for (let i = 0; i < samples; i++) {
      if (i % 2) {
        current.push(compare(after));
        prior.push(compare(before));
      } else {
        prior.push(compare(before));
        current.push(compare(after));
      }
    }
    const baseline = {
      scan: summarize(prior.map((sample) => sample.totalMs)),
      firstYield: summarize(prior.map((sample) => sample.firstYieldMs)),
      rawSamples: prior,
    };
    const candidate = {
      scan: summarize(current.map((sample) => sample.totalMs)),
      firstYield: summarize(current.map((sample) => sample.firstYieldMs)),
      rawSamples: current,
    };
    results.push({ fixture, baseline, candidate, speedup: baseline.scan.medianMs / candidate.scan.medianMs });
  }
  return { ruleCount, samples, correctnessChecks, userAgent: navigator.userAgent, results };
}
