# Developer Guide

> This guide is for Twilio employees working on the SDK. If you're an external developer, the best way to contribute is by building with the SDK, reporting issues, and sharing feedback. See [README.md](README.md) for API docs and usage.

**Linux x86-64 is the only supported platform for the beta.** The macOS x64 build
described below exists for local development. It is not a supported target, CI
does not exercise it, and results there do not stand in for Linux: verify changes
on Linux x86-64 before shipping them.

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

| Tool          | Version                                | Install (macOS)          | Install (Debian/Ubuntu)           |
| ------------- | -------------------------------------- | ------------------------ | --------------------------------- |
| Node.js       | >= 24.0.0                              | `nvm install 24`         | `nvm install 24`                  |
| CMake         | >= 3.15                                | `brew install cmake`     | `apt-get install cmake`           |
| Maven         | >= 3.8                                 | `brew install maven`     | `apt-get install maven`           |
| C++ toolchain | C++17 (clang++ on macOS, g++ on Linux) | Xcode Command Line Tools | `apt-get install build-essential` |

### Linux: X11 development libraries

The link step needs them even though this SDK never captures a screen: libwebrtc's
Linux build pulls in desktop capture, which links X11. Without them the build
fails at link time with `cannot find -lX11` and six similar errors.

```bash
sudo apt-get install -y --no-install-recommends \
  libx11-dev libxext-dev libxdamage-dev libxfixes-dev \
  libxcomposite-dev libxrandr-dev libxtst-dev
```

`docker/Dockerfile` installs the same set, so a container build needs no extra step.

### macOS: Apple Silicon

The native binary is x64-only. Install Rosetta once
(`softwareupdate --install-rosetta`) and run an x64 Node so `process.arch` reports
`x64`. Under a native arm64 Node, `npm install` fails with `EBADPLATFORM` and the
SDK throws `UnsupportedPlatformError` at import.

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

### Tests and checks

Unit tests need the native addon built; integration tests additionally need the
credentials in [section 4](#4-credentials) and reach the live Twilio service.

| Script                     | Description                                                               |
| -------------------------- | ------------------------------------------------------------------------- |
| `npm run test:unit`        | Unit suite (requires the native addon)                                    |
| `npm run test:unit:pure`   | The subset that does not load the addon                                   |
| `npm run test:coverage`    | Unit suite with the coverage thresholds CI enforces                       |
| `npm run test:integration` | End-to-end suite against live Twilio rooms                                |
| `npm test`                 | Everything, unit and integration - needs the credentials in section 4     |
| `npm run lint`             | ESLint                                                                    |
| `npm run format:check`     | Prettier, check only (`npm run format` writes)                            |
| `npm run typecheck`        | `tsc --noEmit` over lib and tests (run `npm run build:ts` first)          |
| `npm run check:examples`   | Syntax-checks the examples and typechecks them against the built `.d.cts` |
| `npm run docs`             | TypeDoc API reference into `docs/`                                        |

## 4. Credentials

The examples load credentials from a `.env` file at the repo root (via the shared
`examples/helpers/token.js` helper). Copy the committed template and fill in your
values:

```sh
cp .env.example .env
# then edit .env and set TWILIO_ACCOUNT_SID / TWILIO_API_KEY / TWILIO_API_SECRET
node examples/audio_push.js [room-name]
```

Get these from the [Twilio Console](https://www.twilio.com/console) under API Keys.
`.env` is gitignored, so your real credentials are never committed.

## 5. Troubleshooting

### `CMake Error ... unable to find Twilio-Video-C++`

No twilio-video-cpp could be located: `TWILIO_VIDEO_SRC_ROOT` is unset and `deps/twilio-video` does not exist. Run `npm run fetch-deps`, or point `TWILIO_VIDEO_SRC_ROOT` at a built local source tree (see [Local source checkout](#local-source-checkout)).

### `No prebuilt binary for <platform>-<arch>, and no local build in build/Release or build/Debug.`

A `NativeBindingLoadError`: the native addon isn't built and no matching prebuild exists. Run `npm run build`. If the message also says to fetch dependencies, `deps/twilio-video` is missing - run `npm run fetch-deps` first.

### `The prebuilt binary at <path> failed to load.` / `The local build at <path> failed to load.`

A `NativeBindingLoadError` with a binary present. It was built for a different Node ABI, or a system library it needs is missing. On Linux that is usually the X11 development packages; see [section 1](#linux-x11-development-libraries). Rebuild with `npm run build`.

### `<platform>-<arch> is not a supported platform.`

An `UnsupportedPlatformError`, thrown before any load is attempted: the addon is not built for this `process.platform`/`process.arch`. There is no arm64 build, so on Apple Silicon this means Node is running as arm64; see [Apple Silicon](#apple-silicon-m1m2m3).

### `TWILIO_ACCOUNT_SID, TWILIO_API_KEY, and TWILIO_API_SECRET are required`

Your `.env` is missing or has empty values for these keys. Copy `.env.example`
to `.env` and fill them in. See [section 4](#4-credentials).

### Maven auth fails with 401

Check that your `~/.m2/settings.xml` is configured correctly and your Artifactory token is valid. See the [Maven auth troubleshooting](#maven-auth-troubleshooting) section for the `RTC_CPP_ARCHIVE` bypass.
