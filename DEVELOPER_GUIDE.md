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

### Download from Artifactory (default)

By default, `fetch-deps` uses Maven to download the twilio-video artifact from Artifactory. You must have Maven installed and a `~/.m2/settings.xml` configured with your Artifactory credentials.

Then run:

```sh
npm run fetch-deps
```

Downloads into `deps/twilio-video/`. Optional vars: `RTC_CPP_VERSION` (default: `7.2.2`), `RTC_CPP_BUILD_TYPE` (default: `release`), `MAVEN_REPO` (default: `internal-releases`).

### Use a local package archive

```sh
npm run fetch-deps -- --twilio-video-pkg /path/to/twilio-video.tar.bz2
```

Alternatively, set the `RTC_CPP_ARCHIVE` environment variable:

```sh
RTC_CPP_ARCHIVE=/path/to/twilio-video.tar.bz2 npm run fetch-deps
```

## 3. Build

```sh
npm install
npm run build
```

To build against a local rtc-cpp source checkout:

```sh
npm run build -- --twilio-video-src /path/to/rtc-cpp
```

| Script                  | Description                         |
| ----------------------- | ----------------------------------- |
| `npm run build`         | Native addon via cmake-js           |
| `npm run build:debug`   | Native addon (debug) via cmake-js   |
| `npm run build:release` | Native addon (release) via cmake-js |
| `npm run build:ts`      | TypeScript (tsdown -> dist/)        |
| `npm run rebuild`       | Clean + full native build           |
| `npm run clean`         | Remove native build artifacts       |
| `npm run package`       | Build + strip + copy to prebuilds/  |

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
