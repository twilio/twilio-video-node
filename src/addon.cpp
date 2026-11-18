#include <napi.h>
#include <cmath>
#include <string>
#include "video/room_wrap.h"
#include "video/local_participant_wrap.h"
#include "video/remote_participant_wrap.h"
#include "media/media_factory_wrap.h"
#include "media/local_video_track_wrap.h"
#include "media/local_audio_track_wrap.h"
#include "media/local_data_track_wrap.h"
#include "media/remote_video_track_wrap.h"
#include "media/remote_audio_track_wrap.h"
#include "media/remote_data_track_wrap.h"
#include "media/openh264_loader.h"
#include "media/openh264_factories.h"
#include "media/openh264_decoder.h"
#include "media/openh264_encoder.h"
#include <cstring>
#include <vector>
#include <libyuv/planar_functions.h>
#include <webrtc/api/video/i420_buffer.h>
#include <webrtc/api/video/video_frame.h>
#include <webrtc/api/video_codecs/video_codec.h>
#include <webrtc/modules/video_coding/include/video_error_codes.h>

#include <twilio/video/video.h>
#include <twilio/log.h>

namespace twilio_video_node {

void SetLogLevel(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected log level argument").ThrowAsJavaScriptException();
        return;
    }

    twilio::LogLevel level;
    if (info[0].IsNumber()) {
        // LogLevel is the contiguous range kOff(0)..kAll(7); reject anything else
        // before casting so an out-of-range number can't become an invalid enum.
        double d = info[0].As<Napi::Number>().DoubleValue();
        if (!std::isfinite(d) || d != std::trunc(d) ||
            d < static_cast<int>(twilio::LogLevel::kOff) ||
            d > static_cast<int>(twilio::LogLevel::kAll)) {
            Napi::RangeError::New(env, "Invalid log level: " + std::to_string(d))
                .ThrowAsJavaScriptException();
            return;
        }
        level = static_cast<twilio::LogLevel>(static_cast<int>(d));
    } else if (info[0].IsString()) {
        std::string s = info[0].As<Napi::String>().Utf8Value();
        if (s == "off") level = twilio::LogLevel::kOff;
        else if (s == "fatal") level = twilio::LogLevel::kFatal;
        else if (s == "error") level = twilio::LogLevel::kError;
        else if (s == "warning") level = twilio::LogLevel::kWarning;
        else if (s == "info") level = twilio::LogLevel::kInfo;
        else if (s == "debug") level = twilio::LogLevel::kDebug;
        else if (s == "trace") level = twilio::LogLevel::kTrace;
        else if (s == "all") level = twilio::LogLevel::kAll;
        else {
            Napi::TypeError::New(env, "Invalid log level: " + s).ThrowAsJavaScriptException();
            return;
        }
    } else {
        Napi::TypeError::New(env, "Expected string or number").ThrowAsJavaScriptException();
        return;
    }

    twilio::setLogLevel(level);
}

Napi::Value LoadOpenH264Binding(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected a library path").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string error;
    auto library = LoadOpenH264(info[0].As<Napi::String>().Utf8Value(), error);
    if (!library) {
        Napi::Error::New(env, error).ThrowAsJavaScriptException();
        return env.Undefined();
    }
    SetLoadedOpenH264(*library);

    Napi::Object version = Napi::Object::New(env);
    version.Set("major", library->version.uMajor);
    version.Set("minor", library->version.uMinor);
    version.Set("revision", library->version.uRevision);
    return version;
}

Napi::Array FormatsToArray(Napi::Env env, const std::vector<webrtc::SdpVideoFormat>& formats) {
    Napi::Array array = Napi::Array::New(env, formats.size());
    for (size_t i = 0; i < formats.size(); ++i) {
        Napi::Object parameters = Napi::Object::New(env);
        for (const auto& [key, value] : formats[i].parameters) parameters.Set(key, value);
        Napi::Object format = Napi::Object::New(env);
        format.Set("name", formats[i].name);
        format.Set("parameters", parameters);
        array.Set(i, format);
    }
    return array;
}

Napi::Value VideoCodecFormats(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto factories = CreateOpenH264Factories();
    if (!factories) return env.Null();

    Napi::Object result = Napi::Object::New(env);
    result.Set("encoders", FormatsToArray(env, factories->encoder->GetSupportedFormats()));
    result.Set("decoders", FormatsToArray(env, factories->decoder->GetSupportedFormats()));
    return result;
}

class CollectEncodedImage : public webrtc::EncodedImageCallback {
public:
    Result OnEncodedImage(const webrtc::EncodedImage& image,
                          const webrtc::CodecSpecificInfo* /*info*/) override {
        images.push_back(image);
        return Result(Result::OK);
    }
    std::vector<webrtc::EncodedImage> images;
};

class CollectDecodedFrame : public webrtc::DecodedImageCallback {
public:
    int32_t Decoded(webrtc::VideoFrame& frame) override {
        frames.push_back(frame);
        return 0;
    }
    std::vector<webrtc::VideoFrame> frames;
};

// Runs one key frame with the given luma plane (chroma neutral) through the
// OpenH264 encoder and decoder a MediaFactory would create. Throws when no
// library is loaded or either codec fails.
Napi::Value EncodeH264Frame(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto library = LoadedOpenH264();
    if (!library) {
        Napi::Error::New(env, "No OpenH264 library is loaded").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    if (info.Length() < 4 || !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber() ||
        !info[3].IsBuffer()) {
        Napi::TypeError::New(env, "Expected width, height, maxFramerate and a luma Buffer")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
    int width = info[0].As<Napi::Number>().Int32Value();
    int height = info[1].As<Napi::Number>().Int32Value();
    auto luma = info[3].As<Napi::Buffer<uint8_t>>();
    if (width < 2 || height < 2 || luma.Length() != static_cast<size_t>(width) * height) {
        Napi::RangeError::New(env, "The luma Buffer must hold width * height bytes")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    webrtc::VideoCodec codec;
    codec.codecType = webrtc::kVideoCodecH264;
    codec.width = width;
    codec.height = height;
    codec.maxFramerate = info[2].As<Napi::Number>().Uint32Value();
    codec.startBitrate = 2000;
    codec.maxBitrate = 4000;
    codec.mode = webrtc::VideoCodecMode::kRealtimeVideo;
    auto encoder = CreateOpenH264Encoder(*library);
    CollectEncodedImage encoded;
    encoder->RegisterEncodeCompleteCallback(&encoded);
    webrtc::VideoEncoder::Settings settings(webrtc::VideoEncoder::Capabilities(false), 1, 1200);
    if (encoder->InitEncode(&codec, settings) != WEBRTC_VIDEO_CODEC_OK) {
        Napi::Error::New(env, "InitEncode failed").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    // WebRTC sets the rates after InitEncode and before the first frame.
    webrtc::VideoBitrateAllocation allocation;
    allocation.SetBitrate(0, 0, codec.startBitrate * 1000);
    encoder->SetRates(webrtc::VideoEncoder::RateControlParameters(allocation, codec.maxFramerate));

    auto buffer = webrtc::I420Buffer::Create(width, height);
    libyuv::CopyPlane(luma.Data(), width, buffer->MutableDataY(), buffer->StrideY(), width, height);
    std::memset(buffer->MutableDataU(), 128, buffer->StrideU() * buffer->ChromaHeight());
    std::memset(buffer->MutableDataV(), 128, buffer->StrideV() * buffer->ChromaHeight());
    webrtc::VideoFrame frame =
        webrtc::VideoFrame::Builder().set_video_frame_buffer(buffer).set_rtp_timestamp(0).build();
    std::vector<webrtc::VideoFrameType> types{webrtc::VideoFrameType::kVideoFrameKey};
    if (encoder->Encode(frame, &types) != WEBRTC_VIDEO_CODEC_OK || encoded.images.size() != 1) {
        Napi::Error::New(env, "Encode produced no frame").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    const webrtc::EncodedImage& image = encoded.images[0];

    auto decoder = CreateOpenH264Decoder(*library);
    CollectDecodedFrame decoded;
    decoder->RegisterDecodeCompleteCallback(&decoded);
    webrtc::VideoDecoder::Settings decoder_settings;
    decoder_settings.set_codec_type(webrtc::kVideoCodecH264);
    if (!decoder->Configure(decoder_settings) || decoder->Decode(image, 0) != WEBRTC_VIDEO_CODEC_OK ||
        decoded.frames.size() != 1) {
        Napi::Error::New(env, "Decode produced no frame").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    auto picture = decoded.frames[0].video_frame_buffer()->ToI420();
    auto decoded_luma = Napi::Buffer<uint8_t>::New(env, picture->width() * picture->height());
    libyuv::CopyPlane(picture->DataY(), picture->StrideY(), decoded_luma.Data(), picture->width(),
                      picture->width(), picture->height());

    Napi::Object decoded_object = Napi::Object::New(env);
    decoded_object.Set("width", picture->width());
    decoded_object.Set("height", picture->height());
    decoded_object.Set("luma", decoded_luma);
    Napi::Object result = Napi::Object::New(env);
    result.Set("bitstream", Napi::Buffer<uint8_t>::Copy(env, image.data(), image.size()));
    result.Set("encodedWidth", static_cast<int>(image._encodedWidth));
    result.Set("encodedHeight", static_cast<int>(image._encodedHeight));
    result.Set("decoded", decoded_object);
    return result;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("setLogLevel", Napi::Function::New(env, SetLogLevel));
    exports.Set("loadOpenH264", Napi::Function::New(env, LoadOpenH264Binding));
    exports.Set("videoCodecFormats", Napi::Function::New(env, VideoCodecFormats));
    exports.Set("encodeH264Frame", Napi::Function::New(env, EncodeH264Frame));

    MediaFactoryWrap::Init(env, exports);
    RoomWrap::Init(env, exports);
    LocalParticipantWrap::Init(env, exports);
    RemoteParticipantWrap::Init(env, exports);
    LocalVideoTrackWrap::Init(env, exports);
    LocalAudioTrackWrap::Init(env, exports);
    LocalDataTrackWrap::Init(env, exports);
    RemoteVideoTrackWrap::Init(env, exports);
    RemoteAudioTrackWrap::Init(env, exports);
    RemoteDataTrackWrap::Init(env, exports);

    return exports;
}

NODE_API_MODULE(twilio_video_sdk_node, Init)

}
