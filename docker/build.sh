#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

IMAGE_NAME="twilio-video-node-linux"

# rtc-cpp has no Linux arm64 build
echo "Building Docker image..."
docker build --platform linux/amd64 -t $IMAGE_NAME -f docker/Dockerfile .

echo ""
echo "Image built: $IMAGE_NAME"
echo ""
echo "To build the SDK, run:"
echo "  ./docker/run.sh"
