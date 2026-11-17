#include "openh264_decoder.h"
#include <webrtc/api/video/encoded_image.h>
#include <webrtc/api/video/i420_buffer.h>
#include <webrtc/api/video/video_frame.h>
#include <webrtc/common_video/h264/h264_bitstream_parser.h>
#include <webrtc/common_video/include/video_frame_buffer_pool.h>
#include <webrtc/modules/video_coding/include/video_error_codes.h>
#include <libyuv/planar_functions.h>

namespace twilio_video_node {

namespace {
class OpenH264Decoder : public webrtc::VideoDecoder {
public:
    explicit OpenH264Decoder(const OpenH264Library& library) : library_(library) {}
    ~OpenH264Decoder() override { Release(); }

    bool Configure(const Settings& settings) override {
        Release();
        if (library_.create_decoder(&decoder_) != 0 || !decoder_) {
            decoder_ = nullptr;
            return false;
        }
        // OpenH264 logs to stderr by default.
        int trace_level = WELS_LOG_QUIET;
        decoder_->SetOption(DECODER_OPTION_TRACE_LEVEL, &trace_level);

        SDecodingParam params{};
        params.sVideoProperty.eVideoBsType = VIDEO_BITSTREAM_DEFAULT;
        // Without concealment a damaged frame fails to decode, and WebRTC asks
        // the sender for a key frame instead of rendering artifacts.
        params.eEcActiveIdc = ERROR_CON_DISABLE;
        if (decoder_->Initialize(&params) != 0) {
            Release();
            return false;
        }
        return true;
    }

    int32_t Decode(const webrtc::EncodedImage& input, int64_t /*render_time_ms*/) override {
        if (!decoder_ || !callback_) return WEBRTC_VIDEO_CODEC_UNINITIALIZED;
        if (!input.data() || input.size() == 0) return WEBRTC_VIDEO_CODEC_ERR_PARAMETER;

        uint8_t* planes[3] = {nullptr, nullptr, nullptr};
        SBufferInfo info{};
        DECODING_STATE state =
            decoder_->DecodeFrameNoDelay(input.data(), static_cast<int>(input.size()), planes, &info);
        if (state != dsErrorFree) return WEBRTC_VIDEO_CODEC_ERROR;
        // A frame of only parameter sets or SEI decodes cleanly without a picture.
        if (info.iBufferStatus != 1) return WEBRTC_VIDEO_CODEC_OK;

        const SSysMEMBuffer& picture = info.UsrData.sSystemBuffer;
        // The planes belong to the decoder and are overwritten by the next call.
        rtc::scoped_refptr<webrtc::I420Buffer> buffer =
            pool_.CreateI420Buffer(picture.iWidth, picture.iHeight);
        if (!buffer) return WEBRTC_VIDEO_CODEC_MEMORY;
        libyuv::I420Copy(planes[0], picture.iStride[0], planes[1], picture.iStride[1], planes[2],
                         picture.iStride[1], buffer->MutableDataY(), buffer->StrideY(),
                         buffer->MutableDataU(), buffer->StrideU(), buffer->MutableDataV(),
                         buffer->StrideV(), picture.iWidth, picture.iHeight);

        webrtc::VideoFrame frame = webrtc::VideoFrame::Builder()
                                       .set_video_frame_buffer(buffer)
                                       .set_rtp_timestamp(input.RtpTimestamp())
                                       .set_color_space(input.ColorSpace())
                                       .build();
        parser_.ParseBitstream(input);
        absl::optional<int> qp = parser_.GetLastSliceQp();
        callback_->Decoded(frame, absl::nullopt,
                           qp ? absl::optional<uint8_t>(static_cast<uint8_t>(*qp)) : absl::nullopt);
        return WEBRTC_VIDEO_CODEC_OK;
    }

    int32_t RegisterDecodeCompleteCallback(webrtc::DecodedImageCallback* callback) override {
        callback_ = callback;
        return WEBRTC_VIDEO_CODEC_OK;
    }

    int32_t Release() override {
        if (decoder_) {
            decoder_->Uninitialize();
            library_.destroy_decoder(decoder_);
            decoder_ = nullptr;
        }
        return WEBRTC_VIDEO_CODEC_OK;
    }

    DecoderInfo GetDecoderInfo() const override {
        DecoderInfo info;
        info.implementation_name = "OpenH264";
        info.is_hardware_accelerated = false;
        return info;
    }

    const char* ImplementationName() const override { return "OpenH264"; }

private:
    OpenH264Library library_;
    ISVCDecoder* decoder_ = nullptr;
    webrtc::DecodedImageCallback* callback_ = nullptr;
    webrtc::H264BitstreamParser parser_;
    // Decoded frames can still be queued for rendering when the next one
    // arrives, so the pool holds several buffers.
    webrtc::VideoFrameBufferPool pool_{/*zero_initialize=*/false, /*max_number_of_buffers=*/300};
};
}  // namespace

std::unique_ptr<webrtc::VideoDecoder> CreateOpenH264Decoder(const OpenH264Library& library) {
    return std::make_unique<OpenH264Decoder>(library);
}

}
