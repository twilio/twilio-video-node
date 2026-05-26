#include "local_video_track_wrap.h"

#include <cmath>
#include <limits>

namespace twilio_video_node {

namespace {
bool ToFiniteInt32(Napi::Value v, int32_t* out) {
    if (!v.IsNumber()) return false;
    double d = v.As<Napi::Number>().DoubleValue();
    if (!std::isfinite(d)) return false;
    if (d != std::trunc(d)) return false;
    if (d < std::numeric_limits<int32_t>::min() || d > std::numeric_limits<int32_t>::max()) return false;
    *out = static_cast<int32_t>(d);
    return true;
}
}

bool PushableVideoSource::PushFrame(rtc::scoped_refptr<webrtc::I420Buffer> buffer,
                                    int64_t timestampUs,
                                    webrtc::VideoRotation rotation) {
    auto system_timestamp = rtc::TimeMicros();
    auto translated_timestamp = timestamp_aligner_.TranslateTimestamp(timestampUs, system_timestamp);

    int adapted_width, adapted_height, crop_width, crop_height, crop_x, crop_y;

    if (!AdaptFrame(buffer->width(), buffer->height(), translated_timestamp,
                    &adapted_width, &adapted_height, &crop_width, &crop_height, &crop_x, &crop_y)) {
        return false;
    }

    rtc::scoped_refptr<webrtc::I420Buffer> adapted_buffer;
    if (adapted_width == buffer->width() && adapted_height == buffer->height()) {
        adapted_buffer = buffer;
    } else {
        adapted_buffer = webrtc::I420Buffer::Create(adapted_width, adapted_height);
        adapted_buffer->CropAndScaleFrom(*buffer.get(), crop_x, crop_y, crop_width, crop_height);
    }

    OnFrame(webrtc::VideoFrame(adapted_buffer, rotation, translated_timestamp));
    return true;
}

Napi::FunctionReference LocalVideoTrackWrap::constructor_;

bool LocalVideoTrackWrap::IsInstance(Napi::Object obj) {
    return obj.InstanceOf(constructor_.Value());
}

void LocalVideoTrackWrap::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "LocalVideoTrack", {
        InstanceAccessor("name", &LocalVideoTrackWrap::GetName, nullptr),
        InstanceAccessor("kind", &LocalVideoTrackWrap::GetKind, nullptr),
        InstanceAccessor("enabled", &LocalVideoTrackWrap::IsEnabled, &LocalVideoTrackWrap::SetEnabled),
        InstanceMethod("write", &LocalVideoTrackWrap::Write),
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

Napi::Value LocalVideoTrackWrap::GetKind(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), "video");
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

Napi::Value LocalVideoTrackWrap::Write(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "write() expects a VideoFrameInput object").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object frame = info[0].As<Napi::Object>();

    if (!frame.Has("y") || !frame.Has("u") || !frame.Has("v") ||
        !frame.Get("y").IsBuffer() || !frame.Get("u").IsBuffer() || !frame.Get("v").IsBuffer()) {
        Napi::TypeError::New(env, "VideoFrameInput requires y, u, v Buffers").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    int32_t width, height, yStride, uStride, vStride;
    if (!ToFiniteInt32(frame.Get("width"), &width) ||
        !ToFiniteInt32(frame.Get("height"), &height) ||
        !ToFiniteInt32(frame.Get("yStride"), &yStride) ||
        !ToFiniteInt32(frame.Get("uStride"), &uStride) ||
        !ToFiniteInt32(frame.Get("vStride"), &vStride)) {
        Napi::TypeError::New(env,
            "VideoFrameInput requires finite integer width, height, yStride, uStride, vStride")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto yBuffer = frame.Get("y").As<Napi::Buffer<uint8_t>>();
    auto uBuffer = frame.Get("u").As<Napi::Buffer<uint8_t>>();
    auto vBuffer = frame.Get("v").As<Napi::Buffer<uint8_t>>();

    if (width <= 0 || height <= 0) {
        Napi::RangeError::New(env, "VideoFrameInput width and height must be positive")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // I420 chroma planes are subsampled 2x in each dimension.
    int uvWidth = (width + 1) / 2;
    int uvHeight = (height + 1) / 2;
    if (yStride < width || uStride < uvWidth || vStride < uvWidth) {
        Napi::RangeError::New(env, "VideoFrameInput strides must be >= plane widths")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    size_t yRequired = static_cast<size_t>(yStride) * static_cast<size_t>(height);
    size_t uRequired = static_cast<size_t>(uStride) * static_cast<size_t>(uvHeight);
    size_t vRequired = static_cast<size_t>(vStride) * static_cast<size_t>(uvHeight);
    if (yBuffer.Length() < yRequired || uBuffer.Length() < uRequired || vBuffer.Length() < vRequired) {
        Napi::RangeError::New(env, "VideoFrameInput plane buffers are smaller than stride*height")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    int64_t timestampUs;
    if (frame.Has("timestampNs") && !frame.Get("timestampNs").IsUndefined()) {
        Napi::Value tsVal = frame.Get("timestampNs");
        if (!tsVal.IsBigInt()) {
            Napi::TypeError::New(env, "VideoFrameInput timestampNs must be a BigInt")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
        bool lossless = false;
        int64_t timestampNs = tsVal.As<Napi::BigInt>().Int64Value(&lossless);
        if (!lossless) {
            Napi::RangeError::New(env, "timestampNs out of range for int64")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
        if (timestampNs < 0) {
            Napi::RangeError::New(env, "timestampNs must be non-negative")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
        timestampUs = timestampNs / 1000;
    } else {
        timestampUs = rtc::TimeMicros();
    }

    webrtc::VideoRotation rotation = webrtc::kVideoRotation_0;
    if (frame.Has("rotation") && !frame.Get("rotation").IsUndefined()) {
        int32_t r;
        if (!ToFiniteInt32(frame.Get("rotation"), &r)) {
            Napi::TypeError::New(env, "VideoFrameInput rotation must be a finite integer")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
        switch (r) {
            case 0:   rotation = webrtc::kVideoRotation_0; break;
            case 90:  rotation = webrtc::kVideoRotation_90; break;
            case 180: rotation = webrtc::kVideoRotation_180; break;
            case 270: rotation = webrtc::kVideoRotation_270; break;
            default:
                Napi::RangeError::New(env, "VideoFrameInput rotation must be 0, 90, 180, or 270")
                    .ThrowAsJavaScriptException();
                return env.Undefined();
        }
    }

    if (!videoSource_) {
        Napi::Error::New(env, "LocalVideoTrack is not bound to a source").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto i420Buffer = webrtc::I420Buffer::Copy(
        width, height,
        yBuffer.Data(), yStride,
        uBuffer.Data(), uStride,
        vBuffer.Data(), vStride);

    bool delivered = videoSource_->PushFrame(i420Buffer, timestampUs, rotation);
    return Napi::Boolean::New(env, delivered);
}

}
