# Developer Guide

> This guide is for Twilio employees working on the SDK. If you're an external developer, the best way to contribute is by building with the SDK, reporting issues, and sharing feedback. See [README.md](README.md) for API docs and usage.

## 1. Prerequisites

| Tool          | Version                                |
| ------------- | -------------------------------------- |
| Node.js       | >= 24.0.0                              |
| CMake         | >= 3.15                                |
| C++ toolchain | C++17 (clang++ on macOS, g++ on Linux) |

## 2. Get rtc-cpp

The native addon links against rtc-cpp (Twilio's C++ Video library).

### Download from Artifactory

```sh
export ARTIFACTORY_URL="<artifactory-url>"
export ARTIFACTORY_TOKEN="<your-token>"

npm run fetch-deps
```

Downloads into `deps/twilio-video/`. Optional vars: `RTC_CPP_VERSION` (default: `latest`), `RTC_CPP_BUILD_TYPE` (default: `release`).

### Local source checkout

If `../rtc-cpp` exists with a matching build directory (`build-{platform}-{arch}-{build_type}/`), it takes priority over Artifactory artifacts.

## 3. Build

```sh
npm install
npm run build
```

| Script                  | Description                         |
| ----------------------- | ----------------------------------- |
| `npm run build`         | Native addon (debug) via cmake-js   |
| `npm run build:debug`   | Native addon (debug) via cmake-js   |
| `npm run build:release` | Native addon (release) via cmake-js |
| `npm run build:ts`      | TypeScript (tsdown -> dist/)        |
| `npm run rebuild`       | Clean + full native build           |
| `npm run clean`         | Remove native build artifacts       |

## 4. Credentials

Required for examples and integration tests:

```sh
export TWILIO_ACCOUNT_SID="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export TWILIO_API_KEY="SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export TWILIO_API_SECRET="your_api_secret"
```

Get these from the [Twilio Console](https://www.twilio.com/console) under API Keys.

## 5. Troubleshooting

### `FATAL_ERROR: No rtc-cpp found.`

Neither `../rtc-cpp` nor `deps/twilio-video` exists. Run `npm run fetch-deps` or check out rtc-cpp as a sibling directory.

### `rtc-cpp build directory not found: .../build-darwin-x86_64-debug`

Local `../rtc-cpp` detected but the build directory for your platform/arch/build-type is missing. Build rtc-cpp for the correct target, or remove `../rtc-cpp` to fall through to Artifactory artifacts.

### `Cannot find module '.../twilio_video_sdk_node.node'`

Native addon not built. Run `npm run build`. If using Artifactory, ensure `npm run fetch-deps` succeeded first.

### `TWILIO_ACCOUNT_SID, TWILIO_API_KEY, and TWILIO_API_SECRET are required`

Environment variables not set. See [section 4](#4-credentials).
