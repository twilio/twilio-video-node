#pragma once

#include <webrtc/api/video_codecs/video_decoder_factory.h>
#include <webrtc/api/video_codecs/video_encoder_factory.h>
#include <memory>
#include <optional>

namespace twilio_video_node {

struct OpenH264Factories {
    std::unique_ptr<webrtc::VideoEncoderFactory> encoder;
    std::unique_ptr<webrtc::VideoDecoderFactory> decoder;
};

// Returns video codec factories that add H.264 through the OpenH264 library
// loaded by loadOpenH264, or nullopt when none is loaded, so rtc-cpp keeps its
// built-in factories.
std::optional<OpenH264Factories> CreateOpenH264Factories();

}
