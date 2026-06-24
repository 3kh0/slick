'use strict';

const marks = [];
let reported = false;

const fmt = (ms) => (ms >= 9999.5 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
const line = (m) => `  +${Math.round(m.t)}ms  ${m.label}${m.ms !== undefined ? ` (${fmt(m.ms)})` : ''}`;

function push(m) {
  if (reported) console.log(`[slick-perf] ${line(m)} (post-report)`);
  else marks.push(m);
}

function mark(label) {
  push({ label, t: performance.now() });
}

function span() {
  const start = performance.now();
  return (label) => push({ label, t: performance.now(), ms: performance.now() - start });
}

function report({ launcherMs = 0, pluginTimings = [], sink } = {}) {
  if (reported || !marks.length) return;
  reported = true;
  const ordered = marks.toSorted((a, b) => a.t - b.t);
  const total = ordered[ordered.length - 1].t;
  const lines = [`boot timeline, ${fmt(total)} total (+ms since electron start):`];
  if (launcherMs) lines.push(`  launcher -> electron start: ${fmt(launcherMs)} (quit old Slack + spawn)`);
  const w = String(Math.round(total)).length;
  for (const m of ordered) {
    lines.push(`  +${String(Math.round(m.t)).padStart(w)}ms  ${m.label}${m.ms !== undefined ? ` (${fmt(m.ms)})` : ''}`);
  }
  marks.length = 0;
  if (pluginTimings.length) {
    const byTime = pluginTimings.toSorted((a, b) => b.ms - a.ms);
    lines.push(`  plugin load: ${byTime.map((p) => `${p.name} ${fmt(p.ms)}`).join(', ')}`);
  }
  for (const l of lines) console.log(`[slick-perf] ${l}`);
  try {
    sink?.(lines.join('\n'));
  } catch {}
}

module.exports = { mark, span, report };
