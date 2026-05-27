#!/usr/bin/env node

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const { ROOT, log } = require('./common');

const buildType = (process.env.RTC_CPP_BUILD_TYPE || 'release').replace(/^./, c => c.toUpperCase());
const debugFlag = buildType === 'Debug' ? ' --debug' : '';

const args = process.argv.slice(2);
const srcIndex = args.indexOf('--twilio-video-src');
const srcRoot = srcIndex !== -1 ? args[srcIndex + 1] : process.env.TWILIO_VIDEO_SRC_ROOT;

let cmakeDefines = '';
if (srcRoot) {
  const resolved = path.resolve(srcRoot);
  cmakeDefines = ` --CDTWILIO_VIDEO_SRC_ROOT="${resolved}"`;
  log('build', `Using twilio-video-cpp source: ${resolved}`);
}

const cmd = `npx cmake-js build${debugFlag}${cmakeDefines}`;
log('build', `Building (${buildType})`);
log('build', `> ${cmd}`);
execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
