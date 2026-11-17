#pragma once

#include "openh264_loader.h"
#include <webrtc/api/video_codecs/video_decoder.h>
#include <memory>

namespace twilio_video_node {

// An H.264 decoder backed by `library`, producing I420 frames.
std::unique_ptr<webrtc::VideoDecoder> CreateOpenH264Decoder(const OpenH264Library& library);

}
