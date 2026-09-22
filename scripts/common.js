'use strict';

const path = require('path');

const ADDON_NAME = 'twilio_video_sdk_node.node';
const ROOT = path.join(__dirname, '..');

function getPlatformDir() {
  return `${process.platform}-${process.arch}`;
}

function getPrebuiltPath(platformDir) {
  const name = `${ADDON_NAME.replace('.node', '')}-${platformDir}.node`;
  return path.join(ROOT, 'prebuilds', platformDir, name);
}

function log(prefix, msg) {
  console.log(`[${prefix}] ${msg}`);
}

module.exports = {
  ADDON_NAME,
  ROOT,
  getPlatformDir,
  getPrebuiltPath,
  log,
};
