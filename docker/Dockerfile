ARG BASE_IMAGE=rtc-cpp-29
FROM $BASE_IMAGE

# Install Node.js 24
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g cmake-js

# WebRTC requires X11 libs (screen capture deps) and PulseAudio (audio device manager)
RUN apt-get update && apt-get install -y \
    pulseaudio \
    libx11-dev libxext-dev libxdamage-dev libxfixes-dev \
    libxcomposite-dev libxrandr-dev libxtst-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/twilio/twilio-video-node
