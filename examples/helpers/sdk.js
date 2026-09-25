// Resolves the SDK for the examples.
//
// In a repo checkout the local build is used, so the examples exercise the code
// under development and CI's `check:examples` job keeps failing on a removed or
// renamed SDK method. Outside a checkout - a customer who installed the
// examples' dependencies - there is no build, and the published package is used
// instead.
//
// The JSDoc `import('../dist/index.cjs')` type annotations in the examples
// deliberately still point at the build, so `typecheck:examples` type-checks
// against local source rather than whatever version is installed.

const { requireExampleDep, missingModule } = require('./example-deps');

const LOCAL_BUILD = '../../dist/index.cjs';

// Typed as the local build, so `typecheck:examples` resolves every SDK symbol
// the examples use against local source.
/** @type {import('../../dist/index.cjs')} */
let sdk;
try {
  sdk = require(LOCAL_BUILD);
} catch (err) {
  // Fall back only when the build itself is absent. A build that exists but
  // fails to load - a missing transitive dependency, say - must surface rather
  // than be masked by the published package.
  if (missingModule(err) !== LOCAL_BUILD) throw err;
  sdk = requireExampleDep('@twilio/video-node-sdk');
}

module.exports = sdk;
