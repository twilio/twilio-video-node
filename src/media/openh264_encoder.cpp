#include "openh264_encoder.h"
#include <webrtc/api/video/encoded_image.h>
#include <webrtc/api/video/i420_buffer.h>
#include <webrtc/common_video/h264/h264_bitstream_parser.h>
#include <webrtc/modules/video_coding/include/video_codec_interface.h>
#include <webrtc/modules/video_coding/include/video_error_codes.h>
#include <algorithm>
#include <cmath>
#include <cstring>

namespace twilio_video_node {

namespace {
// QP range the quality scaler keeps H.264 in before changing resolution.
constexpr int kLowQpThreshold = 24;
constexpr int kHighQpThreshold = 37;

// Limits of H.264 level 3.1 (Table A-1), the level the encoder factory
// advertises. OpenH264 raises the level of a stream that exceeds them instead
// of limiting it, so the encoder keeps within them itself.
constexpr int kMaxMacroblocks = 3600;
constexpr int kMaxMacroblocksPerSecond = 108000;
// sqrt(8 * kMaxMacroblocks): the longest side a level 3.1 frame may have.
constexpr int kMaxMacroblocksPerSide = 169;

int Macroblocks(int pixels) { return (pixels + 15) / 16; }

bool FitsLevel(int width, int height) {
    int columns = Macroblocks(width);
    int rows = Macroblocks(height);
    return columns * rows <= kMaxMacroblocks && columns <= kMaxMacroblocksPerSide &&
           rows <= kMaxMacroblocksPerSide;
}

// Shrinks `width` x `height` to the largest even size with about the same
// aspect ratio that fits level 3.1. Leaves a size that already fits unchanged.
void FitToLevel(int& width, int& height) {
    if (FitsLevel(width, height)) return;
    double scale = std::min({std::sqrt(kMaxMacroblocks * 256.0 / (static_cast<double>(width) * height)),
                             kMaxMacroblocksPerSide * 16.0 / width, kMaxMacroblocksPerSide * 16.0 / height});
    while (true) {
        int scaled_width = std::max(2, static_cast<int>(width * scale) & ~1);
        int scaled_height = std::max(2, static_cast<int>(height * scale) & ~1);
        if (FitsLevel(scaled_width, scaled_height)) {
            width = scaled_width;
            height = scaled_height;
            return;
        }
        scale *= 0.99;
    }
}

class OpenH264Encoder : public webrtc::VideoEncoder {
public:
    explicit OpenH264Encoder(const OpenH264Library& library) : library_(library) {}
    ~OpenH264Encoder() override { Release(); }

    int InitEncode(const webrtc::VideoCodec* codec, const Settings& settings) override {
        if (!codec || codec->codecType != webrtc::kVideoCodecH264 || codec->maxFramerate == 0 ||
            codec->width < 1 || codec->height < 1) {
            return WEBRTC_VIDEO_CODEC_ERR_PARAMETER;
        }
        if (codec->numberOfSimulcastStreams > 1) {
            return WEBRTC_VIDEO_CODEC_ERR_SIMULCAST_PARAMETERS_NOT_SUPPORTED;
        }
        Release();

        if (library_.create_encoder(&encoder_) != 0 || !encoder_) {
            encoder_ = nullptr;
            return WEBRTC_VIDEO_CODEC_ERROR;
        }
        // OpenH264 logs to stderr by default.
        int trace_level = WELS_LOG_QUIET;
        encoder_->SetOption(ENCODER_OPTION_TRACE_LEVEL, &trace_level);

        width_ = codec->width;
        height_ = codec->height;
        FitToLevel(width_, height_);
        // OpenH264 picks the level from this rate, and later SetRates calls
        // don't change it, so a cap here keeps the stream labeled level 3.1.
        // Rate control still follows the rate SetRates passes.
        float max_framerate = static_cast<float>(kMaxMacroblocksPerSecond) /
                              (Macroblocks(width_) * Macroblocks(height_));
        SEncParamExt params;
        encoder_->GetDefaultParams(&params);
        params.iUsageType = codec->mode == webrtc::VideoCodecMode::kScreensharing
                                ? SCREEN_CONTENT_REAL_TIME
                                : CAMERA_VIDEO_REAL_TIME;
        params.iPicWidth = width_;
        params.iPicHeight = height_;
        params.iTargetBitrate = codec->startBitrate * 1000;
        // WebRTC's max bitrate is not OpenH264's iMaxBitrate, which caps every
        // window of frames; rate control follows SetRates instead.
        params.iMaxBitrate = UNSPECIFIED_BIT_RATE;
        params.iRCMode = RC_BITRATE_MODE;
        params.fMaxFrameRate = std::min(static_cast<float>(codec->maxFramerate), max_framerate);
        params.bEnableFrameSkip = codec->GetFrameDropEnabled();
        params.uiIntraPeriod = codec->H264().keyFrameInterval;
        // Reuses SPS ids, so hardware decoders don't reset on every key frame.
        params.eSpsPpsIdStrategy = SPS_LISTING;
        params.iMultipleThreadIdc = 1;
        params.sSpatialLayers[0].iVideoWidth = width_;
        params.sSpatialLayers[0].iVideoHeight = height_;
        params.sSpatialLayers[0].fFrameRate = params.fMaxFrameRate;
        params.sSpatialLayers[0].iSpatialBitrate = params.iTargetBitrate;
        params.sSpatialLayers[0].iMaxSpatialBitrate = params.iMaxBitrate;
        params.sSpatialLayers[0].sSliceArgument.uiSliceNum = 1;
        params.sSpatialLayers[0].sSliceArgument.uiSliceMode = SM_FIXEDSLCNUM_SLICE;
        if (encoder_->InitializeExt(&params) != 0) {
            Release();
            return WEBRTC_VIDEO_CODEC_ERROR;
        }
        int format = videoFormatI420;
        encoder_->SetOption(ENCODER_OPTION_DATAFORMAT, &format);
        sending_ = params.iTargetBitrate > 0;
        key_frame_request_ = true;
        return WEBRTC_VIDEO_CODEC_OK;
    }

    int32_t RegisterEncodeCompleteCallback(webrtc::EncodedImageCallback* callback) override {
        callback_ = callback;
        return WEBRTC_VIDEO_CODEC_OK;
    }

    int32_t Release() override {
        if (encoder_) {
            encoder_->Uninitialize();
            library_.destroy_encoder(encoder_);
            encoder_ = nullptr;
        }
        return WEBRTC_VIDEO_CODEC_OK;
    }

    void SetRates(const RateControlParameters& parameters) override {
        if (!encoder_ || parameters.framerate_fps < 1.0) return;
        uint32_t bitrate = parameters.bitrate.get_sum_bps();
        if (bitrate == 0) {
            sending_ = false;
            return;
        }
        // A stream that resumes needs a key frame before the receiver can decode it.
        if (!sending_) key_frame_request_ = true;
        sending_ = true;

        SBitrateInfo target{};
        target.iLayer = SPATIAL_LAYER_ALL;
        target.iBitrate = static_cast<int>(bitrate);
        encoder_->SetOption(ENCODER_OPTION_BITRATE, &target);
        float framerate = static_cast<float>(parameters.framerate_fps);
        encoder_->SetOption(ENCODER_OPTION_FRAME_RATE, &framerate);
    }

    int32_t Encode(const webrtc::VideoFrame& frame,
                   const std::vector<webrtc::VideoFrameType>* frame_types) override {
        if (!encoder_ || !callback_) return WEBRTC_VIDEO_CODEC_UNINITIALIZED;
        if (!sending_) return WEBRTC_VIDEO_CODEC_OK;
        if (frame_types && !frame_types->empty()) {
            if ((*frame_types)[0] == webrtc::VideoFrameType::kEmptyFrame) return WEBRTC_VIDEO_CODEC_OK;
            if ((*frame_types)[0] == webrtc::VideoFrameType::kVideoFrameKey) key_frame_request_ = true;
        }

        rtc::scoped_refptr<webrtc::VideoFrameBuffer> input = frame.video_frame_buffer();
        if (input->width() != width_ || input->height() != height_) input = input->Scale(width_, height_);
        rtc::scoped_refptr<webrtc::I420BufferInterface> buffer = input->ToI420();
        if (!buffer) return WEBRTC_VIDEO_CODEC_ENCODER_FAILURE;

        SSourcePicture picture{};
        picture.iPicWidth = width_;
        picture.iPicHeight = height_;
        picture.iColorFormat = videoFormatI420;
        picture.uiTimeStamp = frame.ntp_time_ms();
        picture.iStride[0] = buffer->StrideY();
        picture.iStride[1] = buffer->StrideU();
        picture.iStride[2] = buffer->StrideV();
        picture.pData[0] = const_cast<uint8_t*>(buffer->DataY());
        picture.pData[1] = const_cast<uint8_t*>(buffer->DataU());
        picture.pData[2] = const_cast<uint8_t*>(buffer->DataV());

        if (key_frame_request_) {
            // Forces an IDR whatever the argument says.
            encoder_->ForceIntraFrame(true);
            key_frame_request_ = false;
        }

        SFrameBSInfo info;
        std::memset(&info, 0, sizeof(info));
        if (encoder_->EncodeFrame(&picture, &info) != 0) return WEBRTC_VIDEO_CODEC_ERROR;

        webrtc::EncodedImage image;
        CopyBitstream(info, image);
        // Empty when rate control skipped the frame.
        if (image.size() == 0) return WEBRTC_VIDEO_CODEC_OK;

        image._encodedWidth = width_;
        image._encodedHeight = height_;
        image.SetRtpTimestamp(frame.rtp_timestamp());
        image.SetColorSpace(frame.color_space());
        image._frameType = info.eFrameType == videoFrameTypeIDR
                               ? webrtc::VideoFrameType::kVideoFrameKey
                               : webrtc::VideoFrameType::kVideoFrameDelta;
        parser_.ParseBitstream(image);
        image.qp_ = parser_.GetLastSliceQp().value_or(-1);

        webrtc::CodecSpecificInfo codec_info;
        codec_info.codecType = webrtc::kVideoCodecH264;
        codec_info.codecSpecific.H264.packetization_mode = webrtc::H264PacketizationMode::NonInterleaved;
        codec_info.codecSpecific.H264.temporal_idx = webrtc::kNoTemporalIdx;
        codec_info.codecSpecific.H264.idr_frame = info.eFrameType == videoFrameTypeIDR;
        codec_info.codecSpecific.H264.base_layer_sync = false;
        callback_->OnEncodedImage(image, &codec_info);
        return WEBRTC_VIDEO_CODEC_OK;
    }

    EncoderInfo GetEncoderInfo() const override {
        EncoderInfo info;
        info.supports_native_handle = false;
        info.implementation_name = "OpenH264";
        info.scaling_settings = ScalingSettings(kLowQpThreshold, kHighQpThreshold);
        info.is_hardware_accelerated = false;
        info.supports_simulcast = false;
        info.preferred_pixel_formats = {webrtc::VideoFrameBuffer::Type::kI420};
        return info;
    }

private:
    // Copies every NAL unit of every layer, start codes included, into `image`.
    static void CopyBitstream(const SFrameBSInfo& info, webrtc::EncodedImage& image) {
        size_t size = 0;
        for (int layer = 0; layer < info.iLayerNum; ++layer) {
            const SLayerBSInfo& layer_info = info.sLayerInfo[layer];
            for (int nal = 0; nal < layer_info.iNalCount; ++nal) size += layer_info.pNalLengthInByte[nal];
        }
        auto buffer = webrtc::EncodedImageBuffer::Create(size);
        size_t offset = 0;
        for (int layer = 0; layer < info.iLayerNum; ++layer) {
            const SLayerBSInfo& layer_info = info.sLayerInfo[layer];
            size_t layer_size = 0;
            for (int nal = 0; nal < layer_info.iNalCount; ++nal) layer_size += layer_info.pNalLengthInByte[nal];
            std::memcpy(buffer->data() + offset, layer_info.pBsBuf, layer_size);
            offset += layer_size;
        }
        image.SetEncodedData(buffer);
        image.set_size(size);
    }

    OpenH264Library library_;
    ISVCEncoder* encoder_ = nullptr;
    webrtc::EncodedImageCallback* callback_ = nullptr;
    webrtc::H264BitstreamParser parser_;
    int width_ = 0;
    int height_ = 0;
    bool sending_ = false;
    bool key_frame_request_ = false;
};
}  // namespace

std::unique_ptr<webrtc::VideoEncoder> CreateOpenH264Encoder(const OpenH264Library& library) {
    return std::make_unique<OpenH264Encoder>(library);
}

}
