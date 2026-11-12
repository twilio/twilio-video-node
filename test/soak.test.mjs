import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fdCount, threadCount } from './soak_counters.mjs';
import { soakFindings } from './soak_findings.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SELF = fileURLToPath(import.meta.url);

/** A summary that breaches no rule. */
const clean = {
  mode: 'full',
  trendIsMeaningful: true,
  rssSlopeMBPerHour: 1,
  rssGrowthPct: 1,
  fdStart: 40,
  fdEnd: 40,
  threadStart: 30,
  threadEnd: 30,
  videoDelivered: 100,
  audioDelivered: 100,
  videoWritten: 100,
};
const rssBreach = { ...clean, rssSlopeMBPerHour: 50, rssGrowthPct: 30 };

describe('soakFindings', () => {
  it('fails the run on RSS growth by default', () => {
    const { problems } = soakFindings(rssBreach);
    expect(problems).toEqual([
      'RSS trending +50.0 MB/hour after warm-up',
      'RSS grew 30.0% between halves of the steady-state window',
    ]);
  });

  it('reports RSS growth as advisory with rssAdvisory', () => {
    const { problems, advisories } = soakFindings(rssBreach, { rssAdvisory: true });
    expect(problems).toEqual([]);
    expect(advisories).toEqual([
      'RSS trending +50.0 MB/hour after warm-up',
      'RSS grew 30.0% between halves of the steady-state window',
    ]);
  });

  it('still fails on an fd rise with rssAdvisory', () => {
    const { problems } = soakFindings(
      { ...rssBreach, fdStart: 40, fdEnd: 100 },
      { rssAdvisory: true },
    );
    expect(problems).toEqual(['fd count rose 40 -> 100']);
  });
});

describe('soak counters', () => {
  // Above pid_max on Linux (at most 2^22) and on macOS (99998).
  const NO_SUCH_PID = 4_194_305;

  it('counts each newly opened file descriptor', () => {
    const before = fdCount(process.pid);
    const fds = Array.from({ length: 5 }, () => fs.openSync(SELF, 'r'));
    try {
      expect(fdCount(process.pid)).toBe(before + 5);
    } finally {
      for (const fd of fds) fs.closeSync(fd);
    }
  });

  it('counts a newly started thread', async () => {
    const before = threadCount(process.pid);
    const worker = new Worker('setInterval(() => {}, 1000)', { eval: true });
    try {
      await new Promise((resolve, reject) => {
        worker.once('online', resolve);
        worker.once('error', reject);
      });
      expect(threadCount(process.pid)).toBeGreaterThan(before);
    } finally {
      await worker.terminate();
    }
  });

  it.runIf(process.platform === 'linux')('counts on Linux without starting a process', () => {
    const savedPath = process.env.PATH;
    // With no PATH, any lsof or ps fallback fails to spawn.
    process.env.PATH = '';
    try {
      expect(fdCount(process.pid)).toBeGreaterThan(0);
      expect(threadCount(process.pid)).toBeGreaterThan(0);
    } finally {
      if (savedPath === undefined) delete process.env.PATH;
      else process.env.PATH = savedPath;
    }
  });

  it('throws when the fd count is unavailable', () => {
    expect(() => fdCount(NO_SUCH_PID)).toThrow();
  });

  it('throws when the thread count is unavailable', () => {
    expect(() => threadCount(NO_SUCH_PID)).toThrow();
  });
});

const FAKE_CREDENTIALS = {
  TWILIO_ACCOUNT_SID: 'ACfake',
  TWILIO_API_KEY: 'SKfake',
  TWILIO_API_SECRET: 'fake',
};
const SOAK_ARGS = ['test/soak.mjs', '--minutes', '1', '--sample', '1', '--out', 'out.json'];

/**
 * Copies the real script beside a fake dist/index.mjs and returns the directory.
 * `counters` replaces soak_counters.mjs with a helper of that name.
 */
function stageSoak({ counters } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soak-test-'));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.mkdirSync(path.join(dir, 'dist'));
  for (const file of ['soak.mjs', 'soak_findings.mjs', 'soak_counters.mjs']) {
    fs.copyFileSync(path.join(HERE, file), path.join(dir, 'test', file));
  }
  fs.copyFileSync(
    path.join(HERE, 'helpers', 'soak_fake_sdk.mjs'),
    path.join(dir, 'dist', 'index.mjs'),
  );
  if (counters) {
    fs.copyFileSync(
      path.join(HERE, 'helpers', counters),
      path.join(dir, 'test', 'soak_counters.mjs'),
    );
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
  return dir;
}

describe('soak.mjs on room failure', () => {
  let dir;
  let run;

  beforeAll(() => {
    dir = stageSoak();
    fs.writeFileSync(path.join(dir, 'out.jsonl'), 'left over from an earlier run\n');
    run = spawnSync(process.execPath, SOAK_ARGS, {
      cwd: dir,
      encoding: 'utf-8',
      // A hang is the failure this catches.
      timeout: 20_000,
      killSignal: 'SIGKILL',
      env: { ...process.env, ...FAKE_CREDENTIALS },
    });
  }, 30_000);

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('exits with status 1 while local tracks are still open', () => {
    expect(run.signal, run.stdout).toBeNull();
    expect(run.status, run.stdout).toBe(1);
    expect(run.stdout).toContain('SOAK ABORTED: alice disconnected unexpectedly');
  });

  it('writes the samples taken before the failure', () => {
    const out = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf-8'));
    expect(out.samples.length).toBeGreaterThan(0);
  });

  it("replaces an earlier run's JSONL", () => {
    const first = fs.readFileSync(path.join(dir, 'out.jsonl'), 'utf-8').split('\n')[0];
    expect(JSON.parse(first).rssMB).toBeGreaterThan(0);
  });
});

describe('soak.mjs when a counter fails mid-run', () => {
  let dir;
  let run;

  beforeAll(() => {
    dir = stageSoak({ counters: 'soak_failing_counters.mjs' });
    run = spawnSync(process.execPath, SOAK_ARGS, {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 20_000,
      killSignal: 'SIGKILL',
      env: { ...process.env, ...FAKE_CREDENTIALS },
    });
  }, 30_000);

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('exits with status 2, a script error', () => {
    expect(run.status, run.stdout + run.stderr).toBe(2);
    expect(run.stdout).toContain('SOAK FAILED: Error: fd counter failed on a sampler tick');
  });
});

describe('soak.mjs killed before the end of the run', () => {
  let dir;

  beforeAll(() => {
    dir = stageSoak();
    fs.writeFileSync(path.join(dir, 'out.json'), '{"left over from an earlier run":true}');
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the samples taken so far in JSONL', async () => {
    const jsonl = path.join(dir, 'out.jsonl');
    const child = spawn(process.execPath, SOAK_ARGS, {
      cwd: dir,
      env: { ...process.env, ...FAKE_CREDENTIALS },
    });
    let output = '';
    child.stdout.on('data', chunk => (output += chunk));
    child.stderr.on('data', chunk => (output += chunk));
    const exited = new Promise(resolve => child.once('exit', resolve));
    try {
      // The run writes its JSON about 4 s in; kill it as soon as a sample is on disk.
      const deadline = Date.now() + 10_000;
      while (!(fs.existsSync(jsonl) && fs.readFileSync(jsonl, 'utf-8').includes('\n'))) {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`soak exited before writing a JSONL sample:\n${output}`);
        }
        if (Date.now() > deadline) throw new Error('no JSONL sample within 10 s');
        await new Promise(r => setTimeout(r, 20));
      }
      expect(fs.existsSync(path.join(dir, 'out.json'))).toBe(false);
    } finally {
      child.kill('SIGKILL');
      await exited;
    }
    const lines = fs.readFileSync(jsonl, 'utf-8').trim().split('\n');
    expect(JSON.parse(lines[0]).rssMB).toBeGreaterThan(0);
  }, 20_000);
});
