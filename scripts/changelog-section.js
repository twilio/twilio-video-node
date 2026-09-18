#!/usr/bin/env node

'use strict';

// Turns the top section of CHANGELOG.md into release notes, and fails when
// that section is not the version being released. Used by release.yml; not
// shipped in the package.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');

function fail(msg) {
  console.error(`[changelog] ${msg}`);
  process.exit(1);
}

const expected = process.argv[2];
if (!expected) {
  fail('Usage: node scripts/changelog-section.js <version> [outfile]');
}
const outFile = process.argv[3];

const lines = fs.readFileSync(CHANGELOG, 'utf8').split('\n');

// Headings are `# <version> (<date>)`, or `(In Progress)` before the release
// date is filled in. `##` subsections belong to the section above them.
const headingIndexes = lines.reduce((acc, line, i) => {
  if (/^# /.test(line)) {
    acc.push(i);
  }
  return acc;
}, []);

if (headingIndexes.length === 0) {
  fail(`${CHANGELOG} has no "# <version>" heading.`);
}

const start = headingIndexes[0];
const heading = lines[start];
const found = heading.replace(/^#\s+/, '').split(/\s+/)[0];

if (found !== expected) {
  fail(
    `The first CHANGELOG heading is "${heading.trim()}", but ${expected} is being released. ` +
      'Move the entry for this version to the top, or correct the version.',
  );
}

const end = headingIndexes[1] ?? lines.length;
const body = lines
  .slice(start + 1, end)
  .join('\n')
  .trim();

if (!body) {
  fail(`The ${expected} section is empty. Release notes would say nothing.`);
}

if (outFile) {
  fs.writeFileSync(outFile, `${body}\n`);
  console.log(`[changelog] Wrote the ${expected} section to ${outFile}`);
} else {
  process.stdout.write(`${body}\n`);
}
