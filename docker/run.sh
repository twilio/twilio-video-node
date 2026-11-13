#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

IMAGE_NAME="twilio-video-node-linux"

# Only a source build needs rtc-cpp; the default build fetches it into deps/
RTC_CPP_MOUNT=()
if [ -d ../rtc-cpp ]; then
    RTC_CPP_MOUNT=(-v "$(cd ../rtc-cpp && pwd):/opt/twilio/rtc-cpp")
fi

# Otherwise Docker creates these as root
mkdir -p node_modules build deps dist

docker run --platform linux/amd64 -it --rm \
    "${RTC_CPP_MOUNT[@]}" \
    -v "$(pwd):/opt/twilio/twilio-video-node" \
    -v /opt/twilio/twilio-video-node/node_modules \
    -v /opt/twilio/twilio-video-node/build \
    -v /opt/twilio/twilio-video-node/deps \
    -v /opt/twilio/twilio-video-node/dist \
    $IMAGE_NAME \
    bash
