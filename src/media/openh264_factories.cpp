#include "openh264_factories.h"
#include "openh264_decoder.h"
#include "openh264_encoder.h"
#include "openh264_loader.h"
#include <webrtc/api/video_codecs/video_decoder_factory_template.h>
#include <webrtc/api/video_codecs/video_decoder_factory_template_dav1d_adapter.h>
#include <webrtc/api/video_codecs/video_decoder_factory_template_libvpx_vp8_adapter.h>
#include <webrtc/api/video_codecs/video_decoder_factory_template_libvpx_vp9_adapter.h>
#include <webrtc/api/video_codecs/video_encoder_factory_template.h>
#include <webrtc/api/video_codecs/video_encoder_factory_template_libvpx_vp8_adapter.h>
#include <webrtc/api/video_codecs/video_encoder_factory_template_libvpx_vp9_adapter.h>
#include <webrtc/media/base/media_constants.h>
#include <webrtc/modules/video_coding/codecs/h264/include/h264.h>
#include <webrtc/third_party/abseil-cpp/absl/strings/match.h>

namespace twilio_video_node {

namespace {
// The same codecs rtc-cpp uses when no factory is injected.
using BuiltinEncoderFactory = webrtc::VideoEncoderFactoryTemplate<
    webrtc::LibvpxVp8EncoderTemplateAdapter, webrtc::LibvpxVp9EncoderTemplateAdapter>;
using BuiltinDecoderFactory = webrtc::VideoDecoderFactoryTemplate<
    webrtc::LibvpxVp8DecoderTemplateAdapter, webrtc::LibvpxVp9DecoderTemplateAdapter,
    webrtc::Dav1dDecoderTemplateAdapter>;

// The only H.264 the SFU accepts: Constrained Baseline level 3.1 with
// non-interleaved packetization.
webrtc::SdpVideoFormat H264Format() {
    return webrtc::CreateH264Format(webrtc::H264Profile::kProfileConstrainedBaseline,
                                    webrtc::H264Level::kLevel3_1, "1");
}

bool IsH264(const webrtc::SdpVideoFormat& format) {
    return absl::EqualsIgnoreCase(format.name, cricket::kH264CodecName);
}

// H.264 goes last, so an offer without codec preferences still leads with VP8.
class OpenH264EncoderFactory : public webrtc::VideoEncoderFactory {
public:
    explicit OpenH264EncoderFactory(const OpenH264Library& library) : library_(library) {}

    std::vector<webrtc::SdpVideoFormat> GetSupportedFormats() const override {
        auto formats = builtin_.GetSupportedFormats();
        formats.push_back(H264Format());
        return formats;
    }

    CodecSupport QueryCodecSupport(const webrtc::SdpVideoFormat& format,
                                   absl::optional<std::string> scalability_mode) const override {
        if (IsH264(format)) return VideoEncoderFactory::QueryCodecSupport(format, scalability_mode);
        return builtin_.QueryCodecSupport(format, scalability_mode);
    }

    std::unique_ptr<webrtc::VideoEncoder> Create(const webrtc::Environment& env,
                                                 const webrtc::SdpVideoFormat& format) override {
        if (IsH264(format)) return CreateOpenH264Encoder(library_);
        return builtin_.Create(env, format);
    }

private:
    OpenH264Library library_;
    BuiltinEncoderFactory builtin_;
};

class OpenH264DecoderFactory : public webrtc::VideoDecoderFactory {
public:
    explicit OpenH264DecoderFactory(const OpenH264Library& library) : library_(library) {}

    std::vector<webrtc::SdpVideoFormat> GetSupportedFormats() const override {
        auto formats = builtin_.GetSupportedFormats();
        formats.push_back(H264Format());
        return formats;
    }

    CodecSupport QueryCodecSupport(const webrtc::SdpVideoFormat& format,
                                   bool reference_scaling) const override {
        if (IsH264(format)) return VideoDecoderFactory::QueryCodecSupport(format, reference_scaling);
        return builtin_.QueryCodecSupport(format, reference_scaling);
    }

    std::unique_ptr<webrtc::VideoDecoder> Create(const webrtc::Environment& env,
                                                 const webrtc::SdpVideoFormat& format) override {
        if (IsH264(format)) return CreateOpenH264Decoder(library_);
        return builtin_.Create(env, format);
    }

private:
    OpenH264Library library_;
    BuiltinDecoderFactory builtin_;
};
}  // namespace

std::optional<OpenH264Factories> CreateOpenH264Factories() {
    auto library = LoadedOpenH264();
    if (!library) return std::nullopt;
    return OpenH264Factories{std::make_unique<OpenH264EncoderFactory>(*library),
                             std::make_unique<OpenH264DecoderFactory>(*library)};
}

}
