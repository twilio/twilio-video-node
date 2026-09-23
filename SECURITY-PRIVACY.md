# Security and privacy

What this SDK does with decoded media, and which obligations remain with the
application. [README.md](README.md) covers usage,
[LIFECYCLE.md](LIFECYCLE.md) covers object ownership and teardown.

This document describes SDK behavior. It is not legal advice and does not
establish Twilio's obligations under any agreement.

## Where decoded media goes

The SDK decodes subscribed audio and video in the Node process and delivers the
decoded frames to the application. Video frames carry raw, uncompressed planes;
audio frames carry uncompressed PCM. Both reach the application as ordinary
JavaScript objects in the process heap, readable by any code in the process.

This differs from Twilio's browser and mobile Video SDKs, which run on an end
user's own device and deliver media to a rendering surface. Here, decoded media
is present in application memory on whatever host runs the process.

Once a frame reaches the application, what happens to it is the application's
responsibility: how it is processed, where it is written, whether it is
forwarded to another service, and who can read it. The SDK applies no
restriction to a delivered frame and has no view of what the application does
with it.

## Protected health information

Twilio Programmable Video is a HIPAA-eligible service, and Twilio will sign a
Business Associate Addendum with covered entities and business associates. See
[HIPAA Accounts](https://www.twilio.com/docs/iam/twilio-editions/hippa) for how
eligibility is configured on an account.

The SDK provides no PHI-aware primitives: no tagging, redaction, retention
control, encryption-at-rest helper or access control for the decoded media
described above. An application handling PHI supplies all of these itself.

## Retention

The SDK does not persist media. Frames are delivered to the application and
released; nothing is written to disk. The only filesystem access is reading
`package.json` and locating the prebuilt native addon at load time.
Observed: no media write path exists in either the JavaScript or the native
layer.

Any persistence of media, or of data derived from media, is created by the
application and retained under its own policy.
