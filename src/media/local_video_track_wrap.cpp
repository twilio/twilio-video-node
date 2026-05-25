#include "local_video_track_wrap.h"

namespace twilio_video_node {

void PushableVideoSource::PushFrame(rtc::scoped_refptr<webrtc::I420Buffer> buffer,
                                    int64_t timestampUs,
                                    webrtc::VideoRotation rotation) {
    auto system_timestamp = rtc::TimeMicros();
    auto translated_timestamp = timestamp_aligner_.TranslateTimestamp(timestampUs, system_timestamp);

    int adapted_width, adapted_height, crop_width, crop_height, crop_x, crop_y;

    if (!AdaptFrame(buffer->width(), buffer->height(), translated_timestamp,
                    &adapted_width, &adapted_height, &crop_width, &crop_height, &crop_x, &crop_y)) {
        return;
    }

    rtc::scoped_refptr<webrtc::I420Buffer> adapted_buffer;
    if (adapted_width == buffer->width() && adapted_height == buffer->height()) {
        adapted_buffer = buffer;
    } else {
        adapted_buffer = webrtc::I420Buffer::Create(adapted_width, adapted_height);
        adapted_buffer->CropAndScaleFrom(*buffer.get(), crop_x, crop_y, crop_width, crop_height);
    }

    OnFrame(webrtc::VideoFrame(adapted_buffer, rotation, translated_timestamp));
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
        return Napi::Boolean::New(env, false);
    }

    Napi::Object frame = info[0].As<Napi::Object>();

    if (!frame.Has("y") || !frame.Has("u") || !frame.Has("v") ||
        !frame.Get("y").IsBuffer() || !frame.Get("u").IsBuffer() || !frame.Get("v").IsBuffer()) {
        Napi::TypeError::New(env, "VideoFrameInput requires y, u, v Buffers").ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }

    Napi::Value widthVal = frame.Get("width");
    Napi::Value heightVal = frame.Get("height");
    Napi::Value yStrideVal = frame.Get("yStride");
    Napi::Value uStrideVal = frame.Get("uStride");
    Napi::Value vStrideVal = frame.Get("vStride");
    if (!widthVal.IsNumber() || !heightVal.IsNumber() ||
        !yStrideVal.IsNumber() || !uStrideVal.IsNumber() || !vStrideVal.IsNumber()) {
        Napi::TypeError::New(env, "VideoFrameInput requires numeric width, height, yStride, uStride, vStride")
            .ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }

    auto yBuffer = frame.Get("y").As<Napi::Buffer<uint8_t>>();
    auto uBuffer = frame.Get("u").As<Napi::Buffer<uint8_t>>();
    auto vBuffer = frame.Get("v").As<Napi::Buffer<uint8_t>>();
    int width = widthVal.As<Napi::Number>().Int32Value();
    int height = heightVal.As<Napi::Number>().Int32Value();
    int yStride = yStrideVal.As<Napi::Number>().Int32Value();
    int uStride = uStrideVal.As<Napi::Number>().Int32Value();
    int vStride = vStrideVal.As<Napi::Number>().Int32Value();

    if (width <= 0 || height <= 0) {
        Napi::RangeError::New(env, "VideoFrameInput width and height must be positive")
            .ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }

    // I420 chroma planes are subsampled 2x in each dimension.
    int uvWidth = (width + 1) / 2;
    int uvHeight = (height + 1) / 2;
    if (yStride < width || uStride < uvWidth || vStride < uvWidth) {
        Napi::RangeError::New(env, "VideoFrameInput strides must be >= plane widths")
            .ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }

    size_t yRequired = static_cast<size_t>(yStride) * static_cast<size_t>(height);
    size_t uRequired = static_cast<size_t>(uStride) * static_cast<size_t>(uvHeight);
    size_t vRequired = static_cast<size_t>(vStride) * static_cast<size_t>(uvHeight);
    if (yBuffer.Length() < yRequired || uBuffer.Length() < uRequired || vBuffer.Length() < vRequired) {
        Napi::RangeError::New(env, "VideoFrameInput plane buffers are smaller than stride*height")
            .ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }

    int64_t timestampUs;
    if (frame.Has("timestampNs") && frame.Get("timestampNs").IsBigInt()) {
        bool lossless = false;
        int64_t timestampNs = frame.Get("timestampNs").As<Napi::BigInt>().Int64Value(&lossless);
        if (!lossless || timestampNs < 0) {
            Napi::RangeError::New(env, "timestampNs must be a non-negative BigInt that fits in int64")
                .ThrowAsJavaScriptException();
            return Napi::Boolean::New(env, false);
        }
        timestampUs = timestampNs / 1000;
    } else {
        timestampUs = rtc::TimeMicros();
    }

    webrtc::VideoRotation rotation = webrtc::kVideoRotation_0;
    if (frame.Has("rotation") && frame.Get("rotation").IsNumber()) {
        int r = frame.Get("rotation").As<Napi::Number>().Int32Value();
        switch (r) {
            case 90:  rotation = webrtc::kVideoRotation_90; break;
            case 180: rotation = webrtc::kVideoRotation_180; break;
            case 270: rotation = webrtc::kVideoRotation_270; break;
            default:  rotation = webrtc::kVideoRotation_0; break;
        }
    }

    auto i420Buffer = webrtc::I420Buffer::Copy(
        width, height,
        yBuffer.Data(), yStride,
        uBuffer.Data(), uStride,
        vBuffer.Data(), vStride);

    if (!videoSource_) {
        return Napi::Boolean::New(env, false);
    }

    videoSource_->PushFrame(i420Buffer, timestampUs, rotation);
    return Napi::Boolean::New(env, true);
}

}
