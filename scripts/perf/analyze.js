#!/usr/bin/env node
'use strict';

const fs = require('fs');

const BUDGETS = {
  core: {
    startupP50: { relative: 0.1, absolute: 250 },
    startupP95: { relative: 0.15, absolute: 500 },
  },
  defaults: {
    startupP50: { relative: 0.15, absolute: 350 },
    startupP95: { relative: 0.2, absolute: 750 },
  },
  interactionP95: { absolute: 50, ceiling: 200 },
  idleCpu: { points: 2 },
  memory: { relative: 0.1, absoluteKb: 100 * 1024 },
  longTasks: { relative: 0.15 },
};

function percentile(values, amount) {
  if (!values.length) return 0;
  const ordered = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  if (!ordered.length) return 0;
  return ordered[Math.max(0, Math.ceil(ordered.length * amount) - 1)];
}

function summarize(values) {
  const clean = values.filter(Number.isFinite);
  const average = clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
  const variance =
    clean.length > 1 ? clean.reduce((sum, value) => sum + (value - average) ** 2, 0) / (clean.length - 1) : 0;
  return {
    count: clean.length,
    mean: average,
    ci95: clean.length > 1 ? (1.96 * Math.sqrt(variance)) / Math.sqrt(clean.length) : 0,
    p50: percentile(clean, 0.5),
    p95: percentile(clean, 0.95),
    min: clean.length ? Math.min(...clean) : 0,
    max: clean.length ? Math.max(...clean) : 0,
  };
}

function groupRuns(runs, byPlatform = false) {
  const groups = new Map();
  for (const run of runs) {
    const platform = byPlatform ? `${run.platform || 'unknown'}/${run.arch || 'unknown'}|` : '';
    const key = `${platform}${run.variant}:${run.cold ? 'cold' : 'warm'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run);
  }
  return groups;
}

function metrics(runs) {
  const processSamples = runs.flatMap((run) => run.processSamples || []);
  const cpu = summarize(processSamples.map((item) => item.cpuPercent));
  const memory = summarize(processSamples.map((item) => item.privateKb));
  const longTasks = summarize(runs.map((run) => run.renderer?.longTasks?.totalMs).filter(Number.isFinite));
  const memoryGrowth = summarize(
    runs
      .map((run) => {
        const samples = run.processSamples || [];
        return samples.length > 1 ? samples.at(-1).privateKb - samples[0].privateKb : null;
      })
      .filter(Number.isFinite),
  );
  return {
    startup: summarize(runs.map((run) => run.startupMs)),
    workspace: summarize(runs.map((run) => run.workspaceReadyMs)),
    interaction: summarize(runs.flatMap((run) => run.interactions || []).map((item) => item.durationMs)),
    idleCpu: cpu.mean,
    privateKb: memory.mean,
    longTaskMs: longTasks.mean,
    memoryGrowthKb: memoryGrowth.mean,
    noise: {
      cpuCi95: cpu.ci95,
      memoryCi95: memory.ci95,
      longTaskCi95: longTasks.ci95,
      memoryGrowthCi95: memoryGrowth.ci95,
    },
    crashes: runs.reduce((sum, run) => sum + (run.crashes || 0), 0),
    hangs: runs.reduce((sum, run) => sum + (run.hangs || 0), 0),
  };
}

function combinedNoise(candidate, stock) {
  return 2 * Math.hypot(candidate || 0, stock || 0);
}

function exceedsBoth(candidate, stock, budget, noise = 0) {
  return candidate - stock > Math.max(budget.absolute, noise) && candidate > stock * (1 + budget.relative);
}

function compareVariant(name, candidate, stock) {
  const budget = BUDGETS[name] || BUDGETS.defaults;
  const failures = [];
  const startupNoise = combinedNoise(candidate.startup.ci95, stock.startup.ci95);
  if (exceedsBoth(candidate.startup.p50, stock.startup.p50, budget.startupP50, startupNoise)) {
    failures.push(`startup p50 ${Math.round(candidate.startup.p50)}ms vs stock ${Math.round(stock.startup.p50)}ms`);
  }
  if (exceedsBoth(candidate.startup.p95, stock.startup.p95, budget.startupP95, startupNoise)) {
    failures.push(`startup p95 ${Math.round(candidate.startup.p95)}ms vs stock ${Math.round(stock.startup.p95)}ms`);
  }
  if (
    candidate.interaction.count &&
    (candidate.interaction.p95 - stock.interaction.p95 >
      Math.max(BUDGETS.interactionP95.absolute, combinedNoise(candidate.interaction.ci95, stock.interaction.ci95)) ||
      candidate.interaction.p95 > BUDGETS.interactionP95.ceiling)
  ) {
    failures.push(
      `interaction p95 ${Math.round(candidate.interaction.p95)}ms vs stock ${Math.round(stock.interaction.p95)}ms`,
    );
  }
  if (
    candidate.memoryGrowthKb - stock.memoryGrowthKb >
      Math.max(
        BUDGETS.memory.absoluteKb,
        combinedNoise(candidate.noise.memoryGrowthCi95, stock.noise.memoryGrowthCi95),
      ) &&
    candidate.memoryGrowthKb > BUDGETS.memory.absoluteKb
  ) {
    failures.push(
      `memory growth ${Math.round(candidate.memoryGrowthKb / 1024)}MB vs stock ${Math.round(stock.memoryGrowthKb / 1024)}MB`,
    );
  }
  if (
    candidate.idleCpu - stock.idleCpu >
    Math.max(BUDGETS.idleCpu.points, combinedNoise(candidate.noise.cpuCi95, stock.noise.cpuCi95))
  ) {
    failures.push(`idle CPU ${candidate.idleCpu.toFixed(1)}% vs stock ${stock.idleCpu.toFixed(1)}%`);
  }
  if (
    candidate.privateKb - stock.privateKb >
      Math.max(BUDGETS.memory.absoluteKb, combinedNoise(candidate.noise.memoryCi95, stock.noise.memoryCi95)) &&
    candidate.privateKb > stock.privateKb * (1 + BUDGETS.memory.relative)
  ) {
    failures.push(
      `private memory ${Math.round(candidate.privateKb / 1024)}MB vs stock ${Math.round(stock.privateKb / 1024)}MB`,
    );
  }
  if (
    stock.longTaskMs &&
    candidate.longTaskMs > stock.longTaskMs * (1 + BUDGETS.longTasks.relative) &&
    candidate.longTaskMs - stock.longTaskMs > combinedNoise(candidate.noise.longTaskCi95, stock.noise.longTaskCi95)
  ) {
    failures.push(`long tasks ${Math.round(candidate.longTaskMs)}ms vs stock ${Math.round(stock.longTaskMs)}ms`);
  }
  if (candidate.crashes) failures.push(`${candidate.crashes} renderer crash(es)`);
  if (candidate.hangs) failures.push(`${candidate.hangs} renderer hang(s)`);
  return failures;
}

function summariesFor(groups) {
  const summaries = {};
  for (const [key, items] of groups) summaries[key] = metrics(items);
  return summaries;
}

function comparisonsFor(summaries, platformSpecific) {
  const comparisons = {};
  const prefixes = platformSpecific ? [...new Set(Object.keys(summaries).map((key) => key.split('|')[0] + '|'))] : [''];
  for (const prefix of prefixes) {
    const stock = summaries[`${prefix}stock:warm`] || summaries[`${prefix}stock:cold`];
    if (!stock) continue;
    for (const [key, summary] of Object.entries(summaries)) {
      if (!key.startsWith(prefix)) continue;
      const variantKey = key.slice(prefix.length);
      const separator = variantKey.lastIndexOf(':');
      const variant = variantKey.slice(0, separator);
      const temperature = variantKey.slice(separator + 1);
      if (variant === 'stock' || temperature !== 'warm') continue;
      const failures = compareVariant(variant, summary, stock);
      comparisons[key] = { pass: !failures.length, failures };
    }
  }
  return comparisons;
}

function analyze(payload, { enforce = false } = {}) {
  const runs = Array.isArray(payload) ? payload : payload.runs || [];
  const summaries = summariesFor(groupRuns(runs));
  const hasPlatform = runs.some((run) => run.platform && run.arch);
  const platformSummaries = hasPlatform ? summariesFor(groupRuns(runs, true)) : {};
  const comparisons = comparisonsFor(hasPlatform ? platformSummaries : summaries, hasPlatform);
  const presentPlatforms = [
    ...new Set(runs.filter((run) => run.platform && run.arch).map((run) => `${run.platform}/${run.arch}`)),
  ].toSorted();
  const requiredPlatforms = ['darwin/arm64', 'linux/x64', 'win32/x64'];
  const missingPlatforms = requiredPlatforms.filter((name) => !presentPlatforms.includes(name));
  const performancePass = Object.values(comparisons).every((result) => result.pass);
  return {
    schemaVersion: 1,
    advisory: !enforce,
    budgets: BUDGETS,
    summaries,
    platformSummaries,
    comparisons,
    qualification: {
      requiredPlatforms,
      presentPlatforms,
      missingPlatforms,
      performancePass,
      releaseReady: performancePass && !missingPlatforms.length,
    },
  };
}

function format(report) {
  const lines = ['Slick performance report (advisory)'];
  for (const [key, summary] of Object.entries(report.summaries)) {
    lines.push(
      `${key.padEnd(22)} startup p50/p95 ${Math.round(summary.startup.p50)}/${Math.round(summary.startup.p95)}ms` +
        ` | interaction p95 ${Math.round(summary.interaction.p95)}ms` +
        ` | CPU ${summary.idleCpu.toFixed(1)}% | private ${Math.round(summary.privateKb / 1024)}MB`,
    );
  }
  for (const [key, result] of Object.entries(report.comparisons)) {
    lines.push(
      `${result.pass ? 'PASS' : 'FLAG'} ${key}${result.failures.length ? `: ${result.failures.join('; ')}` : ''}`,
    );
  }
  if (report.qualification.missingPlatforms.length) {
    lines.push(`MISSING platform qualification: ${report.qualification.missingPlatforms.join(', ')}`);
  }
  return lines.join('\n');
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/perf/analyze.js <benchmark-results.json> [--json]');
    process.exit(2);
  }
  const enforce = process.argv.includes('--enforce');
  const report = analyze(JSON.parse(fs.readFileSync(file, 'utf8')), { enforce });
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else console.log(format(report));
  if (enforce && !report.qualification.releaseReady) process.exitCode = 1;
}

module.exports = { BUDGETS, analyze, compareVariant, format, metrics, percentile, summarize };
