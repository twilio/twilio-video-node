import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// scripts/changelog-section.js resolves CHANGELOG.md from its own directory's
// parent, so the script is copied into a throwaway tree beside a fixture
// changelog rather than given a path option it would not otherwise need.
let root: string;
let script: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'changelog-section-'));
  fs.mkdirSync(path.join(root, 'scripts'));
  script = path.join(root, 'scripts', 'changelog-section.js');
  fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'changelog-section.js'), script);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Writes the fixture changelog, then runs the script for `version`. */
function run(changelog: string, version: string) {
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), changelog);
  const out = path.join(root, 'notes.md');
  fs.rmSync(out, { force: true });

  const result = spawnSync(process.execPath, [script, version, out], { encoding: 'utf8' });

  return {
    status: result.status,
    stderr: result.stderr,
    notes: fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null,
  };
}

const TWO_SECTIONS = `Preamble that belongs to no release.

# 1.0.0-beta.1 (September 21, 2026)

## Breaking Changes

The beta entry.

# 1.0.0-rc.1 (September 11, 2026)

The rc entry.
`;

describe('changelog-section', () => {
  it('extracts the top section and stops at the next version heading', () => {
    const { status, notes } = run(TWO_SECTIONS, '1.0.0-beta.1');

    expect(status).toBe(0);
    // The heading itself is not part of the notes: release.yml prints its own.
    expect(notes).toBe('## Breaking Changes\n\nThe beta entry.\n');
  });

  it('rejects a top section naming a different version', () => {
    const { status, stderr, notes } = run(TWO_SECTIONS, '1.0.0-rc.1');

    expect(status).toBe(1);
    expect(stderr).toContain('1.0.0-beta.1');
    expect(notes).toBeNull();
  });

  // A prefix comparison would release 1.0.0-beta.10's notes as 1.0.0-beta.1.
  it('does not treat a version as a prefix match', () => {
    const changelog = TWO_SECTIONS.replace('1.0.0-beta.1 (', '1.0.0-beta.10 (');
    const { status, notes } = run(changelog, '1.0.0-beta.1');

    expect(status).toBe(1);
    expect(notes).toBeNull();
  });

  it('rejects a heading that is still in progress', () => {
    const changelog = TWO_SECTIONS.replace('(September 21, 2026)', '(In Progress)');
    const { status, stderr, notes } = run(changelog, '1.0.0-beta.1');

    expect(status).toBe(1);
    expect(stderr).toMatch(/In Progress/i);
    expect(notes).toBeNull();
  });

  it('rejects a section with no entries', () => {
    const changelog = `# 1.0.0-beta.1 (September 21, 2026)

# 1.0.0-rc.1 (September 11, 2026)

The rc entry.
`;
    const { status, notes } = run(changelog, '1.0.0-beta.1');

    expect(status).toBe(1);
    expect(notes).toBeNull();
  });
});
