# Contributing

We are not accepting external code contributions at this time. The most useful way to
contribute is to build with the SDK, report the issues you hit, and share feedback on the
API.

## Reporting a bug

Open a [bug report](https://github.com/twilio/twilio-video-node/issues/new?template=bug_report.md).
A report we can act on includes a minimal script that reproduces the problem, the expected
and actual behavior, and the SDK, Node.js, OS, and architecture versions.

Do not include Access Tokens, API keys, API secrets, or Account SIDs in code, logs, or
screenshots. See [what counts as PII](https://www.twilio.com/docs/glossary/what-is-personally-identifiable-information-pii).

Check [Troubleshooting](DEVELOPER_GUIDE.md#5-troubleshooting) first. The
[`examples/`](examples/) directory is the fastest starting point for a reproduction, and
`node scripts/generate-token.js [identity] [room-name]` prints an Access Token, given
`TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY`, and `TWILIO_API_SECRET`.

## Feature requests and API feedback

Open a [feature request](https://github.com/twilio/twilio-video-node/issues/new?template=feature_request.md).
Describing the problem you're trying to solve is more useful to us than a specific API
proposal, though both are welcome.
