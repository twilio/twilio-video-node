# Contributing

This repository is publicly available and maintained by Twilio under a limited external contribution model.

## Pull requests

Due to limited maintenance capacity, external pull requests are not currently accepted.

## GitHub Issues

GitHub Issues may be used to report reproducible bugs or provide feature feedback about this SDK. Issues are reviewed on a best-effort basis, with no SLA or guaranteed response.

GitHub Issues are not an official Twilio support channel. For production issues, general usage questions, or account-specific assistance, please contact [Twilio Support](https://help.twilio.com/). If you have a Twilio account manager, you may also escalate through them.

Do not share [Personally Identifiable Information (PII)](https://www.twilio.com/docs/glossary/what-is-personally-identifiable-information-pii) or sensitive account information, including access tokens, API keys, and credentials, in issues, logs, or screenshots.

## Security vulnerabilities

Report security vulnerabilities privately through [Twilio's Vulnerability Disclosure Program](https://www.twilio.com/en-us/security/vulnerability-disclosure-program), rather than public GitHub Issues.

## Reporting a bug

Open a [bug report](https://github.com/twilio/twilio-video-node/issues/new?template=bug_report.md).
A report we can act on includes a minimal script that reproduces the problem, the expected
and actual behavior, and the SDK, Node.js, OS, and architecture versions.

Do not include Access Tokens, API keys, API secrets, or Account SIDs in code, logs, or
screenshots. See [what counts as PII](https://www.twilio.com/docs/glossary/what-is-personally-identifiable-information-pii).

Check [Troubleshooting](https://www.twilio.com/docs/video/media-sdk-troubleshooting) first. The
[`examples/`](examples/README.md) directory is the fastest starting point for a reproduction, and
`node scripts/generate-token.js [identity] [room-name]` prints an Access Token, given
`TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY`, and `TWILIO_API_SECRET`.

## Feature requests and API feedback

Open a [feature request](https://github.com/twilio/twilio-video-node/issues/new?template=feature_request.md).
Describing the problem you're trying to solve is more useful to us than a specific API
proposal, though both are welcome.
