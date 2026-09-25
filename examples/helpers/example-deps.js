// Loads a package the examples need, with an actionable message when it is
// absent. The examples depend on packages the SDK itself does not: `twilio` to
// mint Access Tokens, and onnxruntime-node plus @napi-rs/canvas for the
// computer-vision examples. They are declared in examples/package.json.
// Without this, a developer who skips that install sees a raw MODULE_NOT_FOUND
// stack trace from inside a helper.

const path = require('path');

function requireExampleDep(name) {
  try {
    return require(name);
  } catch (err) {
    const error = /** @type {NodeJS.ErrnoException} */ (err);
    if (error.code !== 'MODULE_NOT_FOUND' || !error.message.includes(name)) throw err;

    const examplesDir = path.join(__dirname, '..');
    console.error(`
Error: missing dependency "${name}".

  The examples need packages the SDK itself does not depend on. Install them
  from the examples directory:

    npm install --prefix ${examplesDir}

  Then run this example again.
`);
    process.exit(1);
  }
}

module.exports = { requireExampleDep };
