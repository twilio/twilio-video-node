ARG BASE_IMAGE=rtc-cpp-29
FROM $BASE_IMAGE

# Install Node.js 24
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g cmake-js

# Install PulseAudio for virtual audio device (WebRTC requires ADM)
RUN apt-get update && apt-get install -y pulseaudio && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/twilio/twilio-video-node
