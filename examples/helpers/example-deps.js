// Loads a package the examples need, with an actionable message when it is
// absent. The examples depend on packages the SDK itself does not: `twilio` to
// mint Access Tokens, and onnxruntime-node plus @napi-rs/canvas for the
// computer-vision examples. They are declared in examples/package.json.
// Without this, a developer who skips that install sees a raw MODULE_NOT_FOUND
// stack trace from inside a helper.

const path = require('path');

/**
 * The specifier Node reports as missing, or null when `err` is not a
 * missing-module error.
 *
 * Matched against the first line rather than the whole message: Node appends
 * the require stack, whose paths routinely contain a package's name (every
 * path in this repo contains "twilio"), so a substring test blames the wrong
 * package when a transitive dependency is the one missing.
 *
 * @param {unknown} err
 * @returns {string | null}
 */
function missingModule(err) {
  const error = /** @type {NodeJS.ErrnoException} */ (err);
  if (!error || error.code !== 'MODULE_NOT_FOUND') return null;
  const match = /^Cannot find module '([^']+)'/.exec(error.message ?? '');
  return match ? match[1] : null;
}

function requireExampleDep(name) {
  try {
    return require(name);
  } catch (err) {
    if (missingModule(err) !== name) throw err;

    const examplesDir = path.join(__dirname, '..');
    console.error(`
Error: missing dependency "${name}".

  The examples need packages the SDK itself does not depend on. Install them
  from the examples directory:

    npm install --prefix ${JSON.stringify(examplesDir)}

  Then run this example again.
`);
    process.exit(1);
  }
}

module.exports = { requireExampleDep, missingModule };
