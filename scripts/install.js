#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  ADDON_NAME,
  ROOT,
  getPlatformDir,
  getPrebuiltPath,
  getPrebuiltName,
  getGitHubInfo,
  log,
} = require('./common');

const platformDir = getPlatformDir();
const prebuiltPath = getPrebuiltPath(platformDir);
const releasePath = path.join(ROOT, 'build', 'Release', ADDON_NAME);
const debugPath = path.join(ROOT, 'build', 'Debug', ADDON_NAME);

function exit(msg, code = 1) {
  console.error(`[install] ${msg}`);
  process.exit(code);
}

if (process.env.TWILIO_VIDEO_NODE_SKIP_DOWNLOAD === '1') {
  log('install', 'Skipping download (TWILIO_VIDEO_NODE_SKIP_DOWNLOAD=1)');
  process.exit(0);
}

if (fs.existsSync(prebuiltPath)) {
  log('install', `Prebuilt found: ${prebuiltPath}`);
  process.exit(0);
}

if (fs.existsSync(releasePath) || fs.existsSync(debugPath)) {
  log('install', 'Local build found, skipping download');
  process.exit(0);
}

const pkg = require(path.join(ROOT, 'package.json'));
const ghInfo = getGitHubInfo(pkg);

if (!ghInfo) {
  exit('No repository info. Set GITHUB_REPOSITORY or add repository field to package.json');
}

const assetName = getPrebuiltName(platformDir);
const repo = `${ghInfo.host}/${ghInfo.repo}`;

log('install', `Downloading ${assetName} from ${repo} ${ghInfo.tag}...`);

fs.mkdirSync(path.dirname(prebuiltPath), { recursive: true });

try {
  execFileSync(
    'gh',
    [
      'release',
      'download',
      ghInfo.tag,
      '--repo',
      repo,
      '--pattern',
      assetName,
      '--dir',
      path.dirname(prebuiltPath),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  if (!fs.existsSync(prebuiltPath)) {
    exit(`Asset ${assetName} not found in release ${ghInfo.tag}`);
  }

  const size = fs.statSync(prebuiltPath).size;
  log('install', `Downloaded ${(size / 1024 / 1024).toFixed(1)} MB`);
} catch (err) {
  const stderr = err.stderr?.toString() || err.message;
  exit(`Download failed: ${stderr.trim()}`);
}
