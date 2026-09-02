#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DEPS_DIR = path.join(ROOT, 'deps');

const platformMap = { darwin: 'darwin', linux: 'linux' };
const archMap = { x64: 'x86_64', arm64: 'arm64' };
const platform = platformMap[process.platform];
const arch = archMap[process.arch];

if (!arch) {
  console.error(`[fetch-deps] Unsupported architecture: ${process.arch}`);
  process.exit(1);
}
const buildType = process.env.RTC_CPP_BUILD_TYPE || 'release';
const targetArch = process.env.RTC_CPP_ARCH || archMap[process.arch] || process.arch;

if (!platform) {
  console.error(`[fetch-deps] Unsupported platform: ${process.platform}`);
  process.exit(1);
}

function log(msg) {
  console.log(`[fetch-deps] ${msg}`);
}

const RETRIES = 5;
const VERSION_FILE = path.join(ROOT, '.rtc-cpp-version');

// Kept in its own file so a version bump is a one-line edit to a value that
// build tooling outside this script can read too.
function readPinnedVersion() {
  let contents;
  try {
    contents = fs.readFileSync(VERSION_FILE, 'utf8');
  } catch (err) {
    console.error(`[fetch-deps] Cannot read the rtc-cpp version pin: ${err.message}`);
    process.exit(1);
  }
  const pinned = contents.trim();
  if (!pinned) {
    console.error(`[fetch-deps] The rtc-cpp version pin at ${VERSION_FILE} is empty`);
    process.exit(1);
  }
  return pinned;
}

// Read only by the code paths that download, so a local RTC_CPP_ARCHIVE still
// works in a checkout where the pin is missing.
function resolveVersion() {
  return process.env.RTC_CPP_VERSION || readPinnedVersion();
}

const repo = process.env.MAVEN_REPO || 'releases';
// CI mints its token against ARTIFACTORY_URL, so the download has to address the
// same host the token was issued for.
const baseUrl = (process.env.ARTIFACTORY_URL || 'https://twilio.jfrog.io').replace(/\/+$/, '');
const repoUrl = `${baseUrl}/artifactory/${repo}`;
const tmpFile = path.join(ROOT, '.tmp-twilio-video.tar.bz2');

// Runs one fetch attempt up to RETRIES times. Returns the error from the final
// attempt, so each caller decides how much of it is safe to surface.
function withRetries(attemptFetch) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    log(`Attempt #${attempt} to fetch from Artifactory...`);
    try {
      attemptFetch();
      return null;
    } catch (err) {
      lastErr = err;
    }
  }
  return lastErr;
}

// Fetch with an Artifactory access token instead of Maven credentials. CI mints
// a short-lived one via OIDC; locally a personal token works.
function curlGet(token) {
  const version = resolveVersion();
  // The artifact the Maven coordinates in mvnGet resolve to, addressed directly.
  const downloadUrl = `${repoUrl}/com/twilio/sdk/twilio-video/${version}/twilio-video-${version}-${platform}.tar.bz2`;
  log(`Fetching twilio-video from Artifactory`);
  log(`  url: ${downloadUrl}`);
  const err = withRetries(() =>
    // Token goes in as a curl config file on stdin, never argv: workflow logs
    // and process listings for this repo are public.
    // Timeouts are required: without them a stalled response hangs the process
    // and the retries below never get a turn.
    execFileSync(
      'curl',
      [
        '-fsSL',
        '--connect-timeout',
        '30',
        '--max-time',
        '900',
        '-K',
        '-',
        '-o',
        tmpFile,
        downloadUrl,
      ],
      {
        input: `header = "Authorization: Bearer ${token}"\n`,
        stdio: ['pipe', 'inherit', 'inherit'],
      },
    ),
  );
  if (!err) {
    return;
  }
  // Exit status only, with no error chained on: nothing curl saw of the request
  // or the response reaches the log.
  throw new Error(
    `Artifactory download failed after ${RETRIES} attempts (curl exit ${err.status ?? 'unknown'})`,
  );
}

function mvnGet() {
  const artifact = `com.twilio.sdk:twilio-video:${resolveVersion()}:tar.bz2:${platform}`;
  log(`Fetching twilio-video via Maven`);
  log(`  artifact: ${artifact}`);
  log(`  repo:     ${repoUrl}`);
  const err = withRetries(() =>
    execFileSync(
      'mvn',
      [
        'dependency:get',
        '-Partifactory',
        '--batch-mode',
        '-Dhttps.protocols=TLSv1.2',
        `-DrepoUrl=${repoUrl}`,
        '-Dtransitive=false',
        `-Dartifact=${artifact}`,
        `-Ddest=${tmpFile}`,
      ],
      { stdio: 'inherit' },
    ),
  );
  if (!err) {
    return;
  }
  console.error(
    `[fetch-deps] Tip: you can bypass Maven by setting ARTIFACTORY_TOKEN, or ` +
      `RTC_CPP_ARCHIVE=/path/to/twilio-video-${platform}.tar.bz2`,
  );
  throw new Error(`Maven fetch failed after ${RETRIES} attempts`, { cause: err });
}

function main() {
  try {
    const args = process.argv.slice(2);
    const pkgIndex = args.indexOf('--twilio-video-pkg');
    const localArchive =
      (pkgIndex !== -1 ? args[pkgIndex + 1] : null) || process.env.RTC_CPP_ARCHIVE;
    if (localArchive) {
      const resolved = path.resolve(localArchive);
      if (!fs.existsSync(resolved)) {
        throw new Error(`Local archive not found: ${resolved}`);
      }
      log(`Using local archive: ${resolved}`);
      fs.copyFileSync(resolved, tmpFile);
    } else if (process.env.ARTIFACTORY_TOKEN) {
      curlGet(process.env.ARTIFACTORY_TOKEN);
    } else {
      mvnGet();
    }

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
    const archLibDir = path.join(videoDir, 'lib', arch);
    const compilerDir = fs.existsSync(archLibDir)
      ? fs.readdirSync(archLibDir).find(d => /^appleclang-/.test(d))
      : null;

    const expectedPaths = [
      path.join(videoDir, 'include'),
      path.join(videoDir, 'lib'),
      ...(compilerDir
        ? [path.join(archLibDir, compilerDir, buildType, 'libtwilio-video.a')]
        : [archLibDir]),
    ];

    const missing = expectedPaths.filter(p => !fs.existsSync(p));
    if (missing.length > 0) {
      console.error('[fetch-deps] Extracted archive is missing expected paths:');
      missing.forEach(p => console.error(`  ${p}`));
      console.error('');
      console.error('  Check the twilio-video artifact layout from rtc-cpp.');
      process.exit(1);
    }

    const compilerDirs = fs
      .readdirSync(archLibDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(archLibDir, entry.name));

    if (compilerDirs.length === 0) {
      console.error(
        `[fetch-deps] Extracted archive is missing compiler directories under ${archLibDir}`,
      );
      process.exit(1);
    }

    const libNames = ['libtwilio-video.a', 'libwebrtc.a', 'libjsoncpp.a'];
    const libDir = compilerDirs
      .map(compilerDir => path.join(compilerDir, buildType))
      .find(candidate => libNames.every(lib => fs.existsSync(path.join(candidate, lib))));

    if (!libDir) {
      console.error(
        `[fetch-deps] Extracted archive is missing required ${buildType} libraries for ${targetArch}:`,
      );
      compilerDirs.forEach(compilerDir => console.error(`  ${path.join(compilerDir, buildType)}`));
      console.error('');
      console.error(`  Expected: ${libNames.join(', ')}`);
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
