#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

IMAGE_NAME="twilio-video-node-linux"

# Build Docker image with Node.js
echo "Building Docker image..."
docker build -t $IMAGE_NAME -f docker/Dockerfile .

echo ""
echo "Image built: $IMAGE_NAME"
echo ""
echo "To build the SDK, run:"
echo "  ./docker/run.sh"
