#!/usr/bin/env node

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ADDON_NAME, ROOT, getPlatformDir, getPrebuiltPath, log } = require('./common');

const platformDir = getPlatformDir();
const buildType = process.env.RTC_CPP_BUILD_TYPE || 'release';
const sourcePath = path.join(ROOT, 'build', 'Release', ADDON_NAME);
const prebuiltPath = getPrebuiltPath(platformDir);

function run(cmd) {
  log('prebuild', `> ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

log('prebuild', `Building ${platformDir} (${buildType})`);
run(`npx cmake-js rebuild --CDRTC_CPP_BUILD_TYPE=${buildType}`);

if (!fs.existsSync(sourcePath)) {
  console.error(`[prebuild] Build output not found: ${sourcePath}`);
  process.exit(1);
}

const beforeSize = fs.statSync(sourcePath).size;
log('prebuild', `Built ${(beforeSize / 1024 / 1024).toFixed(1)} MB (unstripped)`);

log('prebuild', 'Stripping symbols...');
run(
  process.platform === 'darwin'
    ? `strip -x "${sourcePath}"`
    : `strip --strip-unneeded "${sourcePath}"`,
);

const afterSize = fs.statSync(sourcePath).size;
log('prebuild', `Stripped to ${(afterSize / 1024 / 1024).toFixed(1)} MB`);

fs.mkdirSync(path.dirname(prebuiltPath), { recursive: true });
fs.copyFileSync(sourcePath, prebuiltPath);
log('prebuild', `Saved to ${prebuiltPath}`);
