#pragma once

#include "openh264_loader.h"
#include <webrtc/api/video_codecs/video_encoder.h>
#include <memory>

namespace twilio_video_node {

// An H.264 encoder backed by `library`: one stream, Constrained Baseline,
// non-interleaved packetization, no simulcast or temporal layers.
std::unique_ptr<webrtc::VideoEncoder> CreateOpenH264Encoder(const OpenH264Library& library);

}
