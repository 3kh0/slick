'use strict';

// Process-tree CPU/memory sampling for the benchmark harness.
//
// Both backends report cumulative CPU time and derive cpuPercent from the delta
// between consecutive samples. `ps -o %cpu` is a *lifetime* average, which folds
// startup burn into every later reading — exactly wrong for an idle-CPU budget,
// which only cares about the observation window.
//
// cpuPercent is "percent of one core", summed across the tree, on every platform.
// privateKb is RSS on POSIX and PrivatePageCount on Windows; the two are not
// comparable across platforms, which is fine because analyze.js only ever
// compares within a platform/arch bucket.

const { execFileSync, spawn } = require('child_process');

// Emits one compact JSON line per poll. Win32_Process reports CPU as cumulative
// 100ns ticks, so the shape matches the POSIX backend after conversion.
const WINDOWS_POLLER = `
$ErrorActionPreference = 'Stop'
while ($true) {
  try {
    $rows = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,KernelModeTime,UserModeTime,PrivatePageCount |
      ForEach-Object {
        '{0},{1},{2},{3}' -f $_.ProcessId, $_.ParentProcessId, ([uint64]$_.KernelModeTime + [uint64]$_.UserModeTime), $_.PrivatePageCount
      }
    [Console]::Out.WriteLine('#' + ($rows -join ';'))
  } catch {
    [Console]::Out.WriteLine('#')
  }
  Start-Sleep -Milliseconds 1000
}
`;

function parsePosixCpuSeconds(value) {
  // ps TIME is [[dd-]hh:]mm:ss[.ff]
  const [days, rest] = value.includes('-') ? value.split('-') : ['0', value];
  const parts = rest.split(':').map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [hours, minutes, seconds] = parts;
  return Number(days) * 86400 + hours * 3600 + minutes * 60 + seconds;
}

function posixRows() {
  const out = execFileSync('ps', ['-axo', 'pid=,ppid=,time=,rss='], { encoding: 'utf8' });
  const rows = [];
  for (const line of out.trim().split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4) continue;
    const pid = Number(fields[0]);
    const ppid = Number(fields[1]);
    const cpuSeconds = parsePosixCpuSeconds(fields[2]);
    const privateKb = Number(fields[3]);
    if (!Number.isFinite(pid) || !Number.isFinite(cpuSeconds)) continue;
    rows.push({ pid, ppid, cpuSeconds, privateKb });
  }
  return rows;
}

function parseWindowsLine(line) {
  const body = line.slice(1);
  if (!body) return [];
  const rows = [];
  for (const entry of body.split(';')) {
    const fields = entry.split(',');
    if (fields.length !== 4) continue;
    const pid = Number(fields[0]);
    const ppid = Number(fields[1]);
    const ticks = Number(fields[2]);
    const privateBytes = Number(fields[3]);
    if (!Number.isFinite(pid) || !Number.isFinite(ticks)) continue;
    // 100ns ticks -> seconds; PrivatePageCount is already bytes.
    rows.push({ pid, ppid, cpuSeconds: ticks / 1e7, privateKb: privateBytes / 1024 });
  }
  return rows;
}

// Descendants of rootPid, including rootPid itself.
function collectTree(rows, rootPid) {
  const ids = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (ids.has(row.ppid) && !ids.has(row.pid)) {
        ids.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.filter((row) => ids.has(row.pid));
}

function createSampler(rootPid) {
  let poller = null;
  let latest = null;
  let stopped = false;
  let previous = null;

  if (process.platform === 'win32') {
    try {
      poller = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_POLLER],
        { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
      );
      let buffer = '';
      poller.stdout.setEncoding('utf8');
      poller.stdout.on('data', (chunk) => {
        buffer += chunk;
        let index = buffer.indexOf('\n');
        while (index !== -1) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (line.startsWith('#')) latest = { atMs: Date.now(), rows: parseWindowsLine(line) };
          index = buffer.indexOf('\n');
        }
      });
      poller.on('error', () => {
        poller = null;
      });
    } catch {
      poller = null;
    }
  }

  // Raw tree totals plus the elapsed window, or null when unavailable.
  function read() {
    if (process.platform === 'win32') {
      if (!poller || !latest) return null;
      return { atMs: latest.atMs, rows: collectTree(latest.rows, rootPid) };
    }
    try {
      return { atMs: Date.now(), rows: collectTree(posixRows(), rootPid) };
    } catch {
      return null;
    }
  }

  return {
    // Returns null until a second reading exists — cpuPercent needs a delta.
    sample() {
      if (stopped) return null;
      const current = read();
      if (!current || !current.rows.length) return null;
      const cpuSeconds = current.rows.reduce((sum, row) => sum + row.cpuSeconds, 0);
      const privateKb = current.rows.reduce((sum, row) => sum + row.privateKb, 0);
      const last = previous;
      previous = { atMs: current.atMs, cpuSeconds };
      if (!last || current.atMs <= last.atMs) return null;
      const elapsedSeconds = (current.atMs - last.atMs) / 1000;
      // Processes that exited between samples can push the tree total backwards.
      const burned = Math.max(0, cpuSeconds - last.cpuSeconds);
      return {
        cpuPercent: Math.round((burned / elapsedSeconds) * 10000) / 100,
        privateKb: Math.round(privateKb),
        processCount: current.rows.length,
      };
    },

    // Must run before the tree is torn down, or the last readings catch a dying process.
    stop() {
      stopped = true;
      if (!poller) return;
      try {
        poller.kill();
      } catch {}
      poller = null;
    },
  };
}

module.exports = { collectTree, createSampler, parsePosixCpuSeconds, parseWindowsLine };
