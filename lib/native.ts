import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { NativeBindingLoadError, UnsupportedPlatformError } from './errors.js';
import type { NativeAddon } from './types.js';

const __filename_ = fileURLToPath(import.meta.url);
const __dirname_ = path.dirname(__filename_);
const nativeRequire = createRequire(import.meta.url);

// Resolve the project root (works from both lib/ and dist/)
const ROOT = fs.existsSync(path.join(__dirname_, '..', 'package.json'))
  ? path.join(__dirname_, '..')
  : path.join(__dirname_, '..', '..');

const PKG: { version: string; os?: string[]; cpu?: string[] } = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'),
);
export const SDK_VERSION = PKG.version;

function getPlatformDir(): string {
  return `${process.platform}-${process.arch}`;
}

function getPrebuiltPath(platformDir: string): string {
  const addonName = 'twilio_video_sdk_node';
  return path.join(ROOT, 'prebuilds', platformDir, `${addonName}-${platformDir}.node`);
}

/**
 * Platforms the published package ships a prebuild for, derived from the `os`
 * and `cpu` fields npm itself enforces at install time. Deriving rather than
 * restating them means the runtime check cannot drift from what the package
 * declares.
 */
const SUPPORTED_PLATFORMS: string[] = (PKG.os ?? ['darwin', 'linux']).flatMap(o =>
  (PKG.cpu ?? ['x64']).map(c => `${o}-${c}`),
);

function loadAddon(): NativeAddon {
  const platformDir = getPlatformDir();
  const prebuiltPath = getPrebuiltPath(platformDir);

  // A local build wins over the prebuilt. `npm run build` in a checkout that
  // also has a prebuilt must run the code that was just compiled, otherwise a
  // stale prebuilt silently shadows it and the test suite reports on a binary
  // nobody built. Trying it before the platform check also lets someone who
  // compiled the addon on a platform this package does not list load it.
  // Consumers never reach this: `files` excludes build/, so an installed
  // package has no local build.
  for (const buildType of ['Release', 'Debug']) {
    const localPath = path.join(ROOT, 'build', buildType, 'twilio_video_sdk_node.node');
    if (!fs.existsSync(localPath)) continue;
    try {
      return nativeRequire(localPath);
    } catch (cause) {
      throw new NativeBindingLoadError(
        `The local build at ${localPath} failed to load. This usually means it was built ` +
          `for a different Node ABI (this is Node ${process.version}, modules ` +
          `${process.versions.modules}) or a required system library is missing. ` +
          'Rebuild with `npm run build`.',
        { cause },
      );
    }
  }

  if (fs.existsSync(prebuiltPath)) {
    // A prebuilt that exists but will not load is a different failure from one
    // that is absent: an ABI mismatch or a missing shared library, not a
    // missing build.
    try {
      return nativeRequire(prebuiltPath);
    } catch (cause) {
      throw new NativeBindingLoadError(
        `The prebuilt binary at ${prebuiltPath} failed to load. This usually means it was ` +
          `built for a different Node ABI (this is Node ${process.version}, modules ` +
          `${process.versions.modules}) or a required system library is missing. ` +
          'Rebuild from source with `npm run build`.',
        { cause },
      );
    }
  }

  // Nothing to load. Fail with the real reason rather than advising a build
  // that cannot succeed. Apple Silicon is the common case: package.json
  // declares cpu x64, so npm refuses to install under an arm64 Node in the
  // first place.
  if (!SUPPORTED_PLATFORMS.includes(platformDir)) {
    throw new UnsupportedPlatformError(
      `${platformDir} is not a supported platform. This SDK ships a prebuilt addon for ` +
        `${SUPPORTED_PLATFORMS.join(' and ')}. ` +
        (process.platform === 'darwin' && process.arch === 'arm64'
          ? 'There is no arm64 build. On Apple Silicon, run Node under Rosetta so ' +
            'process.arch reports x64 (install once with `softwareupdate --install-rosetta`, ' +
            'then use an x64 Node).'
          : 'Contact the Twilio Video team for access to other platforms.'),
    );
  }

  const depsPresent = fs.existsSync(path.join(ROOT, 'deps', 'twilio-video'));
  throw new NativeBindingLoadError(
    `No prebuilt binary for ${platformDir}, and no local build in build/Release or ` +
      'build/Debug. ' +
      (depsPresent
        ? 'Build it with `npm run build`.'
        : 'Fetch the native dependencies first with `npm run fetch-deps`, then build with ' +
          '`npm run build`. On Linux the build also needs the X11 development packages ' +
          '(see DEVELOPER_GUIDE.md).'),
  );
}

/** The loaded native addon. Internal; not exported from the package entry point. */
export const addon: NativeAddon = loadAddon();
