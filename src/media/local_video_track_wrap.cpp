#include "local_video_track_wrap.h"

namespace twilio_video_node {

void PushableVideoSource::PushFrame(rtc::scoped_refptr<webrtc::I420Buffer> buffer, int64_t timestampUs) {
    int adapted_width, adapted_height, crop_width, crop_height, crop_x, crop_y;

    if (!AdaptFrame(buffer->width(), buffer->height(), timestampUs,
                    &adapted_width, &adapted_height, &crop_width, &crop_height, &crop_x, &crop_y)) {
        // Frame dropped by adaptation
        return;
    }

    rtc::scoped_refptr<webrtc::I420Buffer> adapted_buffer;
    if (adapted_width == buffer->width() && adapted_height == buffer->height()) {
        // No adaptation necessary
        adapted_buffer = buffer;
    } else {
        // Adapt by cropping and scaling
        adapted_buffer = webrtc::I420Buffer::Create(adapted_width, adapted_height);
        adapted_buffer->CropAndScaleFrom(*buffer.get(), crop_x, crop_y, crop_width, crop_height);
    }

    webrtc::VideoFrame frame = webrtc::VideoFrame::Builder()
        .set_video_frame_buffer(adapted_buffer)
        .set_timestamp_us(timestampUs)
        .set_rotation(webrtc::kVideoRotation_0)
        .build();
    OnFrame(frame);
}

Napi::FunctionReference LocalVideoTrackWrap::constructor_;

void LocalVideoTrackWrap::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "LocalVideoTrack", {
        InstanceAccessor("name", &LocalVideoTrackWrap::GetName, nullptr),
        InstanceAccessor("enabled", &LocalVideoTrackWrap::IsEnabled, &LocalVideoTrackWrap::SetEnabled),
        InstanceMethod("pushFrame", &LocalVideoTrackWrap::PushFrame),
    });

    constructor_ = Napi::Persistent(func);
    constructor_.SuppressDestruct();
    exports.Set("LocalVideoTrack", func);
}

Napi::Object LocalVideoTrackWrap::NewInstance(Napi::Env env,
                                               std::shared_ptr<twilio::media::MediaFactory> factory,
                                               const twilio::media::VideoTrackOptions& options) {
    Napi::EscapableHandleScope scope(env);

    auto source = rtc::make_ref_counted<PushableVideoSource>();
    auto track = factory->createVideoTrack(source, options);

    Napi::Object obj = constructor_.New({});
    LocalVideoTrackWrap* wrap = Napi::ObjectWrap<LocalVideoTrackWrap>::Unwrap(obj);
    wrap->track_ = track;
    wrap->factory_ = factory;
    wrap->videoSource_ = source;

    return scope.Escape(obj).ToObject();
}

LocalVideoTrackWrap::LocalVideoTrackWrap(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<LocalVideoTrackWrap>(info) {
}

LocalVideoTrackWrap::~LocalVideoTrackWrap() {
}

Napi::Value LocalVideoTrackWrap::GetName(const Napi::CallbackInfo& info) {
    if (!track_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), track_->getName());
}

Napi::Value LocalVideoTrackWrap::IsEnabled(const Napi::CallbackInfo& info) {
    if (!track_) return Napi::Boolean::New(info.Env(), false);
    return Napi::Boolean::New(info.Env(), track_->isEnabled());
}

void LocalVideoTrackWrap::SetEnabled(const Napi::CallbackInfo& info, const Napi::Value& value) {
    if (!track_) return;
    track_->setEnabled(value.As<Napi::Boolean>().Value());
}

Napi::Value LocalVideoTrackWrap::PushFrame(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 5) {
        Napi::TypeError::New(env, "Expected 5 arguments: yPlane, uPlane, vPlane, width, height").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[0].IsBuffer() || !info[1].IsBuffer() || !info[2].IsBuffer()) {
        Napi::TypeError::New(env, "First 3 arguments must be Buffers (Y, U, V planes)").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto yBuffer = info[0].As<Napi::Buffer<uint8_t>>();
    auto uBuffer = info[1].As<Napi::Buffer<uint8_t>>();
    auto vBuffer = info[2].As<Napi::Buffer<uint8_t>>();
    int width = info[3].As<Napi::Number>().Int32Value();
    int height = info[4].As<Napi::Number>().Int32Value();

    // Generate relative timestamps (not from epoch)
    static int64_t base_timestamp_us = 0;
    static auto start_time = std::chrono::steady_clock::now();

    int64_t timestampUs = 0;
    if (info.Length() > 5 && info[5].IsNumber()) {
        timestampUs = static_cast<int64_t>(info[5].As<Napi::Number>().DoubleValue());
    } else {
        if (base_timestamp_us == 0) {
            base_timestamp_us = 1000; // Start at 1ms like TestVideoSource
            start_time = std::chrono::steady_clock::now();
        }
        auto elapsed = std::chrono::steady_clock::now() - start_time;
        timestampUs = base_timestamp_us + std::chrono::duration_cast<std::chrono::microseconds>(elapsed).count();
    }

    auto i420Buffer = webrtc::I420Buffer::Create(width, height);

    int strideY = i420Buffer->StrideY();
    int strideU = i420Buffer->StrideU();
    int strideV = i420Buffer->StrideV();

    memcpy(i420Buffer->MutableDataY(), yBuffer.Data(),
           std::min(yBuffer.Length(), static_cast<size_t>(strideY * height)));

    int uvHeight = (height + 1) / 2;
    memcpy(i420Buffer->MutableDataU(), uBuffer.Data(),
           std::min(uBuffer.Length(), static_cast<size_t>(strideU * uvHeight)));
    memcpy(i420Buffer->MutableDataV(), vBuffer.Data(),
           std::min(vBuffer.Length(), static_cast<size_t>(strideV * uvHeight)));

    if (videoSource_) {
        videoSource_->PushFrame(i420Buffer, timestampUs);
    }

    return env.Undefined();
}

}
