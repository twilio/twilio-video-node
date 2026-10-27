import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { soakFindings } from './soak_findings.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

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

describe('soak.mjs on room failure', () => {
  let dir;
  let run;

  beforeAll(() => {
    // Run the real script beside a fake dist/index.mjs.
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soak-test-'));
    fs.mkdirSync(path.join(dir, 'test'));
    fs.mkdirSync(path.join(dir, 'dist'));
    fs.copyFileSync(path.join(HERE, 'soak.mjs'), path.join(dir, 'test', 'soak.mjs'));
    fs.copyFileSync(
      path.join(HERE, 'soak_findings.mjs'),
      path.join(dir, 'test', 'soak_findings.mjs'),
    );
    fs.copyFileSync(
      path.join(HERE, 'helpers', 'soak_fake_sdk.mjs'),
      path.join(dir, 'dist', 'index.mjs'),
    );
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));

    run = spawnSync(
      process.execPath,
      ['test/soak.mjs', '--minutes', '1', '--sample', '1', '--out', 'out.json'],
      {
        cwd: dir,
        encoding: 'utf-8',
        // A hang is the failure this catches.
        timeout: 20_000,
        killSignal: 'SIGKILL',
        env: {
          ...process.env,
          TWILIO_ACCOUNT_SID: 'ACfake',
          TWILIO_API_KEY: 'SKfake',
          TWILIO_API_SECRET: 'fake',
        },
      },
    );
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
});
