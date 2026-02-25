#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DEPS_DIR = path.join(ROOT, 'deps');

const platformMap = { darwin: 'darwin', linux: 'linux' };
const archMap = { x64: 'x86_64', arm64: 'arm64' };

const platform = platformMap[process.platform];
const arch = archMap[process.arch];
const buildType = process.env.RTC_CPP_BUILD_TYPE || 'release';

if (!platform || !arch) {
  console.error(`[fetch-deps] Unsupported platform: ${process.platform}-${process.arch}`);
  process.exit(1);
}

function log(msg) {
  console.log(`[fetch-deps] ${msg}`);
}

const artifactoryUrl = process.env.ARTIFACTORY_URL;
if (!artifactoryUrl) {
  console.error('[fetch-deps] ARTIFACTORY_URL is not set');
  console.error('  Example: https://twilio.jfrog.io/artifactory/internal-releases');
  process.exit(1);
}

const token = process.env.ARTIFACTORY_TOKEN;
if (!token) {
  console.error('[fetch-deps] ARTIFACTORY_TOKEN is not set');
  process.exit(1);
}

const rtcCppVersion = process.env.RTC_CPP_VERSION || 'latest';
const artifactName = `rtc-cpp-video-package-${platform}-${arch}-${buildType}.tar.gz`;

// Build the download URL
// Adjust this path to match your actual Artifactory repo structure
const url =
  rtcCppVersion === 'latest'
    ? `${artifactoryUrl.replace(/\/$/, '')}/com/twilio/sdk/rtc-cpp-video-package/${artifactName}`
    : `${artifactoryUrl.replace(/\/$/, '')}/com/twilio/sdk/rtc-cpp-video-package/${rtcCppVersion}/${artifactName}`;

log(`Downloading rtc-cpp artifacts for ${platform}-${arch} (${buildType})`);
log(`  ${url}`);

const tmpFile = path.join(ROOT, `.tmp-${artifactName}`);

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));

    const client = url.startsWith('https') ? https : http;
    const parsed = new URL(url);

    client
      .get(
        {
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          port: parsed.port,
          headers: { Authorization: `Bearer ${token}` },
        },
        res => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return resolve(download(res.headers.location, dest, redirects + 1));
          }

          if (res.statusCode !== 200) {
            let body = '';
            res.on('data', c => {
              body += c;
            });
            res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${body}`)));
            return;
          }

          fs.mkdirSync(path.dirname(dest), { recursive: true });
          const file = fs.createWriteStream(dest);
          res.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        },
      )
      .on('error', reject);
  });
}

async function main() {
  try {
    await download(url, tmpFile);

    const size = fs.statSync(tmpFile).size;
    log(`Downloaded ${(size / 1024 / 1024).toFixed(1)} MB`);

    // Clean existing deps
    if (fs.existsSync(DEPS_DIR)) {
      fs.rmSync(DEPS_DIR, { recursive: true });
    }
    fs.mkdirSync(DEPS_DIR, { recursive: true });

    log('Extracting...');
    execSync(`tar xzf "${tmpFile}" -C "${DEPS_DIR}"`, { stdio: 'inherit' });

    // Clean up temp file
    fs.unlinkSync(tmpFile);

    // Verify expected structure
    const expectedPaths = [
      path.join(DEPS_DIR, 'include'),
      path.join(DEPS_DIR, 'video', 'src', 'libtwilio-video.a'),
      path.join(DEPS_DIR, 'third-party', 'webrtc-full-tvi'),
    ];

    const missing = expectedPaths.filter(p => !fs.existsSync(p));
    if (missing.length > 0) {
      console.error('[fetch-deps] Extracted archive is missing expected paths:');
      missing.forEach(p => console.error(`  ${p}`));
      console.error('');
      console.error('  The archive structure may not match expectations.');
      console.error('  Check the rtc-cpp video-package artifact layout.');
      process.exit(1);
    }

    log('rtc-cpp artifacts ready at deps/');
  } catch (err) {
    console.error(`[fetch-deps] Failed: ${err.message}`);
    // Clean up on failure
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    process.exit(1);
  }
}

main();
