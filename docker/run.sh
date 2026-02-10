#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

IMAGE_NAME="twilio-video-node-linux"
RTC_CPP_PATH="$(cd ../rtc-cpp && pwd)"

docker run -it --rm \
    -v "$RTC_CPP_PATH:/opt/twilio/rtc-cpp" \
    -v "$(pwd):/opt/twilio/twilio-video-node" \
    $IMAGE_NAME \
    bash
