'use strict';

const path = require('path');

const ADDON_NAME = 'twilio_video_sdk_node.node';
const ROOT = path.join(__dirname, '..');

function getPlatformDir(override) {
  if (override) {
    return override;
  }
  return `${process.platform}-${process.arch}`;
}

/**
 * Platforms the native addon is built for, derived from the `os` and `cpu`
 * fields npm enforces at install time. Derived rather than restated so this
 * cannot drift from what the package declares; lib/index.ts derives the same
 * list for its runtime check.
 */
function getSupportedPlatforms(pkg) {
  return (pkg.os || ['darwin', 'linux']).flatMap(o => (pkg.cpu || ['x64']).map(c => `${o}-${c}`));
}

function getPrebuiltName(platformDir) {
  return `${ADDON_NAME.replace('.node', '')}-${platformDir}.node`;
}

function getPrebuiltPath(platformDir) {
  return path.join(ROOT, 'prebuilds', platformDir, getPrebuiltName(platformDir));
}

function getGitHubInfo(pkg) {
  let repoUrl = process.env.GITHUB_REPOSITORY || pkg.repository?.url;
  if (!repoUrl) {
    return null;
  }

  repoUrl = repoUrl.replace(/^git\+/, '').replace(/\.git$/, '');
  const match = repoUrl.match(/https?:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    return null;
  }

  return {
    host: match[1],
    repo: match[2],
    version: pkg.version,
    tag: pkg.version,
  };
}

function log(prefix, msg) {
  console.log(`[${prefix}] ${msg}`);
}

module.exports = {
  ADDON_NAME,
  ROOT,
  getPlatformDir,
  getPrebuiltName,
  getPrebuiltPath,
  getSupportedPlatforms,
  getGitHubInfo,
  log,
};
