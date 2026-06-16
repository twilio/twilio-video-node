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

Configure Maven with your Artifactory credentials by creating `~/.m2/settings.xml`:

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

Get your Artifactory token from [twilio.jfrog.io](https://twilio.jfrog.io) under your user profile.

Then fetch the deps:

```sh
npm run fetch-deps
```

Optional vars: `RTC_CPP_VERSION` (default: `7.2.2`), `RTC_CPP_BUILD_TYPE` (default: `release`), `MAVEN_REPO` (default: `releases`).

#### Maven auth troubleshooting

If Maven authentication fails, you can bypass it by downloading the artifact manually and passing it via `RTC_CPP_ARCHIVE`:

```sh
curl -L -H "Authorization: Bearer $ARTIFACTORY_TOKEN" \
  "https://twilio.jfrog.io/artifactory/releases/com/twilio/sdk/twilio-video/7.2.2/twilio-video-7.2.2-darwin.tar.bz2" \
  -o /tmp/twilio-video-darwin.tar.bz2

RTC_CPP_ARCHIVE=/tmp/twilio-video-darwin.tar.bz2 npm run fetch-deps
```

### Local source checkout

If `../rtc-cpp` exists with a matching build directory (`build-{platform}-{arch}-{build_type}/`), it takes priority over Artifactory artifacts.

## 3. Build

```sh
TWILIO_VIDEO_NODE_SKIP_DOWNLOAD=1 npm install
npm run build
npm run build:ts
```

> **Note:** `TWILIO_VIDEO_NODE_SKIP_DOWNLOAD=1` skips the prebuilt binary download in the `install` script. This is required when building from source — the prebuilt download requires `gh` auth to the internal GitHub release.

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

### Maven auth fails with 401

Check that your `~/.m2/settings.xml` is configured correctly and your Artifactory token is valid. See the [Maven auth troubleshooting](#maven-auth-troubleshooting) section for the `RTC_CPP_ARCHIVE` bypass.
