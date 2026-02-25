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
    tag: `v${pkg.version}`,
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
  getGitHubInfo,
  log,
};
