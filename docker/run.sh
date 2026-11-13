#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

IMAGE_NAME="twilio-video-node-linux"
RTC_CPP_PATH="$(cd ../rtc-cpp && pwd)"

# Otherwise Docker creates these as root
mkdir -p node_modules build deps dist

docker run --platform linux/amd64 -it --rm \
    -v "$RTC_CPP_PATH:/opt/twilio/rtc-cpp" \
    -v "$(pwd):/opt/twilio/twilio-video-node" \
    -v /opt/twilio/twilio-video-node/node_modules \
    -v /opt/twilio/twilio-video-node/build \
    -v /opt/twilio/twilio-video-node/deps \
    -v /opt/twilio/twilio-video-node/dist \
    $IMAGE_NAME \
    bash
