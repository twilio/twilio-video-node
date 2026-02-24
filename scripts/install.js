#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { ADDON_NAME, ROOT, getPlatformDir, getPrebuiltPath, getPrebuiltName, getGitHubInfo, log } = require('./common');

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

const url = `https://${ghInfo.host}/${ghInfo.repo}/releases/download/${ghInfo.tag}/${getPrebuiltName(platformDir)}`;

log('install', `Downloading ${platformDir}...`);
log('install', url);

function download(url, dest, redirects = 0) {
    if (redirects > 5) {
        exit('Too many redirects');
    }

    const client = url.startsWith('https') ? https : http;
    const token = process.env.GITHUB_TOKEN;
    const options = token ? {
        ...new URL(url),
        headers: { 'Authorization': `token ${token}` }
    } : url;

    client.get(options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return download(res.headers.location, dest, redirects + 1);
        }

        if (res.statusCode !== 200) {
            exit(`Download failed: HTTP ${res.statusCode}. Try: TWILIO_VIDEO_NODE_SKIP_DOWNLOAD=1 npm install && npm run build`);
        }

        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const file = fs.createWriteStream(dest);
        res.pipe(file);

        file.on('finish', () => {
            file.close();
            const size = fs.statSync(dest).size;
            log('install', `Downloaded ${(size / 1024 / 1024).toFixed(1)} MB`);
        });
    }).on('error', (err) => {
        exit(`Download failed: ${err.message || err.code}`);
    });
}

download(url, prebuiltPath);
