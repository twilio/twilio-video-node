#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { ROOT, getPlatformDir, getPrebuiltPath, getGitHubInfo, log } = require('./common');

const platformDir = getPlatformDir(process.argv[2]);
const prebuiltPath = getPrebuiltPath(platformDir);

if (!fs.existsSync(prebuiltPath)) {
  console.error(`[upload] Prebuilt not found: ${prebuiltPath}`);
  console.error('Run npm run prebuild first');
  process.exit(1);
}

try {
  execSync('gh --version', { stdio: 'ignore' });
} catch (e) {
  console.error('[upload] gh CLI not found: https://cli.github.com/');
  process.exit(1);
}

const pkg = require(path.join(ROOT, 'package.json'));
const ghInfo = getGitHubInfo(pkg);

if (!ghInfo) {
  console.error('[upload] No repository info in package.json');
  process.exit(1);
}

if (ghInfo.host !== 'github.com') {
  process.env.GH_HOST = ghInfo.host;
  log('upload', `Using GitHub Enterprise: ${ghInfo.host}`);
}

const size = fs.statSync(prebuiltPath).size;
log('upload', `Uploading ${platformDir} (${(size / 1024 / 1024).toFixed(1)} MB) to ${ghInfo.tag}`);

try {
  execSync(`gh release view ${ghInfo.tag}`, { stdio: 'ignore' });
  log('upload', 'Release exists');
} catch (e) {
  log('upload', 'Creating release...');
  execSync(
    `gh release create ${ghInfo.tag} --title "${ghInfo.tag}" --notes "Release ${ghInfo.version}"`,
    { stdio: 'inherit' },
  );
}

log('upload', 'Uploading...');
execSync(`gh release upload ${ghInfo.tag} "${prebuiltPath}" --clobber`, { stdio: 'inherit' });
log('upload', 'Complete');
