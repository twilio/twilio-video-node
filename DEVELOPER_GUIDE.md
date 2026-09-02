# Developer Guide

> This guide is for Twilio employees working on the SDK. If you're an external developer, the best way to contribute is by building with the SDK, reporting issues, and sharing feedback. See [README.md](README.md) for API docs and usage.

## Apple Silicon (M1/M2/M3)

The native binary is **x64-only**. On Apple Silicon you must run all build commands under Rosetta. Install Rosetta first if you haven't already:

```sh
softwareupdate --install-rosetta
```

Then prefix every command in this guide with:

```sh
arch -x86_64 bash -c 'source ~/.nvm/nvm.sh && nvm use 24 && <command>'
```

For example:

```sh
arch -x86_64 bash -c 'source ~/.nvm/nvm.sh && nvm use 24 && npm run fetch-deps'
```

## 1. Prerequisites

| Tool          | Version                                | Install (macOS)          |
| ------------- | -------------------------------------- | ------------------------ |
| Node.js       | >= 24.0.0                              | `nvm install 24`         |
| CMake         | >= 3.15                                | `brew install cmake`     |
| Maven         | >= 3.8                                 | `brew install maven`     |
| C++ toolchain | C++17 (clang++ on macOS, g++ on Linux) | Xcode Command Line Tools |

## 2. Get rtc-cpp

The native addon links against rtc-cpp (Twilio's C++ Video library).

### Download from Artifactory

The simplest option is an access token. Get one from [twilio.jfrog.io](https://twilio.jfrog.io) under your user profile, then:

```sh
ARTIFACTORY_TOKEN=YOUR_ARTIFACTORY_TOKEN npm run fetch-deps
```

This downloads the artifact directly, with no Maven setup. CI uses the same path, with a short-lived token from OIDC.

#### Via Maven

Alternatively, configure Maven with your Artifactory credentials by creating `~/.m2/settings.xml`:

```xml
<settings>
  <servers>
    <server>
      <id>artifactory</id>
      <username>your.name@twilio.com</username>
      <password>YOUR_ARTIFACTORY_TOKEN</password>
    </server>
  </servers>
  <profiles>
    <profile>
      <id>artifactory</id>
      <repositories>
        <repository>
          <id>artifactory</id>
          <url>https://twilio.jfrog.io/artifactory/releases</url>
        </repository>
      </repositories>
    </profile>
  </profiles>
</settings>
```

Then fetch the deps:

```sh
npm run fetch-deps
```

The rtc-cpp version is pinned in `.rtc-cpp-version`; bump that file to move to a new release.

Optional vars: `RTC_CPP_VERSION` (overrides the pin), `RTC_CPP_BUILD_TYPE` (default: `release`), `MAVEN_REPO` (default: `releases`).

#### Maven auth troubleshooting

If Maven authentication fails, set `ARTIFACTORY_TOKEN` as shown above. To download the artifact by hand instead and pass it via `RTC_CPP_ARCHIVE`:

```sh
VERSION=$(cat .rtc-cpp-version)
curl -L -H "Authorization: Bearer $ARTIFACTORY_TOKEN" \
  "https://twilio.jfrog.io/artifactory/releases/com/twilio/sdk/twilio-video/$VERSION/twilio-video-$VERSION-darwin.tar.bz2" \
  -o /tmp/twilio-video-darwin.tar.bz2

RTC_CPP_ARCHIVE=/tmp/twilio-video-darwin.tar.bz2 npm run fetch-deps
```

### Local source checkout

To build against a local twilio-video-cpp source tree, point the build at it with `TWILIO_VIDEO_SRC_ROOT=/path/to/rtc-cpp` (or `npm run build -- --twilio-video-src /path/to/rtc-cpp`). The tree must already be built; CMake expects the output under `cmake-build-{build_type}/` (e.g. `cmake-build-release`). When set, this source takes priority over downloaded artifacts and `deps/twilio-video/`.

## 3. Build

```sh
TWILIO_VIDEO_NODE_SKIP_DOWNLOAD=1 npm install
npm run build
npm run build:ts
```

> **Note:** `TWILIO_VIDEO_NODE_SKIP_DOWNLOAD=1` skips the prebuilt binary download in the `install` script. This is required when building from source — the prebuilt download requires `gh` auth to the internal GitHub release.

| Script                  | Description                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run build`         | Native addon via `scripts/build.js` (release by default; set `RTC_CPP_BUILD_TYPE=Debug` for debug) |
| `npm run build:debug`   | Native addon (debug) via cmake-js                                                                  |
| `npm run build:release` | Native addon (release) via cmake-js                                                                |
| `npm run build:ts`      | TypeScript (tsdown -> dist/)                                                                       |
| `npm run rebuild`       | Clean + full native build                                                                          |
| `npm run clean`         | Remove native build artifacts                                                                      |

## 4. Credentials

Required for examples and integration tests:

```sh
export TWILIO_ACCOUNT_SID="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export TWILIO_API_KEY="SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export TWILIO_API_SECRET="your_api_secret"
```

Get these from the [Twilio Console](https://www.twilio.com/console) under API Keys.

## 5. Troubleshooting

### `CMake Error ... unable to find Twilio-Video-C++`

No twilio-video-cpp could be located: `TWILIO_VIDEO_SRC_ROOT` is unset and `deps/twilio-video` does not exist. Run `npm run fetch-deps`, or point `TWILIO_VIDEO_SRC_ROOT` at a built local source tree (see [Local source checkout](#local-source-checkout)).

### `No prebuilt binary found for <platform>-<arch>. Run npm run build to compile from source.`

The native addon isn't built and no matching prebuild exists (the underlying cause reads `Cannot find module '.../twilio_video_sdk_node.node'`). Run `npm run build`. If using Artifactory, ensure `npm run fetch-deps` succeeded first.

### `TWILIO_ACCOUNT_SID, TWILIO_API_KEY, and TWILIO_API_SECRET are required`

Environment variables not set. See [section 4](#4-credentials).

### Maven auth fails with 401

Check that your `~/.m2/settings.xml` is configured correctly and your Artifactory token is valid. See the [Maven auth troubleshooting](#maven-auth-troubleshooting) section for the `RTC_CPP_ARCHIVE` bypass.
