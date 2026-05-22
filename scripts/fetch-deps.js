#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DEPS_DIR = path.join(ROOT, 'deps');

const platformMap = { darwin: 'darwin', linux: 'linux' };

const platform = platformMap[process.platform];
const buildType = process.env.RTC_CPP_BUILD_TYPE || 'release';

if (!platform) {
  console.error(`[fetch-deps] Unsupported platform: ${process.platform}`);
  process.exit(1);
}

function log(msg) {
  console.log(`[fetch-deps] ${msg}`);
}

const RETRIES = 5;
const version = process.env.RTC_CPP_VERSION || 'LATEST';
const repo = process.env.MAVEN_REPO || 'internal-releases';
const repoUrl = `https://twilio.jfrog.io/artifactory/${repo}`;
const artifact = `com.twilio.sdk:twilio-video:${version}:tar.bz2:${platform}`;
const tmpFile = path.join(ROOT, '.tmp-twilio-video.tar.bz2');

log(`Fetching twilio-video via Maven`);
log(`  artifact: ${artifact}`);
log(`  repo:     ${repoUrl}`);

function mvnGet() {
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    log(`Attempt #${attempt} to fetch from Artifactory...`);
    try {
      execSync(
        [
          'mvn', 'dependency:get',
          '-Partifactory',
          '--batch-mode',
          '-Dhttps.protocols=TLSv1.2',
          `-DrepoUrl=${repoUrl}`,
          '-Dtransitive=false',
          `-Dartifact=${artifact}`,
          `-Ddest=${tmpFile}`,
        ].join(' '),
        { stdio: 'inherit' },
      );
      return;
    } catch (err) {
      if (attempt === RETRIES) {
        throw new Error(`Maven fetch failed after ${RETRIES} attempts`);
      }
    }
  }
}

function main() {
  try {
    mvnGet();

    const size = fs.statSync(tmpFile).size;
    log(`Downloaded ${(size / 1024 / 1024).toFixed(1)} MB`);

    if (fs.existsSync(DEPS_DIR)) {
      fs.rmSync(DEPS_DIR, { recursive: true });
    }
    fs.mkdirSync(DEPS_DIR, { recursive: true });

    log('Extracting...');
    execSync(`tar xjf "${tmpFile}" -C "${DEPS_DIR}"`, { stdio: 'inherit' });

    fs.unlinkSync(tmpFile);

    // The Maven artifact extracts to deps/twilio-video/ which CMakeLists.txt expects
    const videoDir = path.join(DEPS_DIR, 'twilio-video');
    const expectedPaths = [
      path.join(videoDir, 'include'),
      path.join(videoDir, 'lib'),
    ];

    const missing = expectedPaths.filter(p => !fs.existsSync(p));
    if (missing.length > 0) {
      console.error('[fetch-deps] Extracted archive is missing expected paths:');
      missing.forEach(p => console.error(`  ${p}`));
      console.error('');
      console.error('  Check the twilio-video artifact layout from rtc-cpp.');
      process.exit(1);
    }

    log(`rtc-cpp artifacts ready at deps/twilio-video/ (${buildType})`);
  } catch (err) {
    console.error(`[fetch-deps] Failed: ${err.message}`);
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    process.exit(1);
  }
}

main();
