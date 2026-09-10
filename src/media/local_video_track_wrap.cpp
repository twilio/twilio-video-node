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
        InstanceMethod("getWriteStats", &LocalVideoTrackWrap::GetWriteStats),
        InstanceMethod("_configureSource", &LocalVideoTrackWrap::ConfigureSource),
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

namespace {
// Reads one I420Plane ({ data, stride, width, height }) off the frame object.
// Returns false with a JS exception pending on any shape or type error.
bool ReadPlane(Napi::Env env, const Napi::Object& frame, const char* key,
               Napi::Buffer<uint8_t>* outData, int32_t* outStride) {
    if (!frame.Has(key)) {
        Napi::TypeError::New(env, std::string("VideoFrameInput requires an I420Plane '") + key + "'")
            .ThrowAsJavaScriptException();
        return false;
    }
    Napi::Value v = frame.Get(key);
    if (!v.IsObject()) {
        Napi::TypeError::New(env, std::string("VideoFrameInput.") + key + " must be an I420Plane object")
            .ThrowAsJavaScriptException();
        return false;
    }
    Napi::Object plane = v.As<Napi::Object>();
    if (!plane.Has("data") || !plane.Get("data").IsBuffer()) {
        Napi::TypeError::New(env, std::string("VideoFrameInput.") + key + ".data must be a Buffer")
            .ThrowAsJavaScriptException();
        return false;
    }
    int32_t stride;
    if (!ToFiniteInt32(plane.Get("stride"), &stride)) {
        Napi::TypeError::New(env, std::string("VideoFrameInput.") + key + ".stride must be a finite integer")
            .ThrowAsJavaScriptException();
        return false;
    }
    *outData = plane.Get("data").As<Napi::Buffer<uint8_t>>();
    *outStride = stride;
    return true;
}
}  // namespace

Napi::Value LocalVideoTrackWrap::Write(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "write() expects a VideoFrameInput object").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object frame = info[0].As<Napi::Object>();

    // `format` is optional but, when present, must be the one format we accept.
    if (frame.Has("format") && !frame.Get("format").IsUndefined()) {
        Napi::Value f = frame.Get("format");
        if (!f.IsString() || f.As<Napi::String>().Utf8Value() != "I420") {
            Napi::TypeError::New(env, "VideoFrameInput.format must be 'I420'")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
    }

    int32_t width, height;
    if (!ToFiniteInt32(frame.Get("width"), &width) ||
        !ToFiniteInt32(frame.Get("height"), &height)) {
        Napi::TypeError::New(env, "VideoFrameInput requires finite integer width and height")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Buffer<uint8_t> yBuffer, uBuffer, vBuffer;
    int32_t yStride, uStride, vStride;
    if (!ReadPlane(env, frame, "y", &yBuffer, &yStride)) return env.Undefined();
    if (!ReadPlane(env, frame, "u", &uBuffer, &uStride)) return env.Undefined();
    if (!ReadPlane(env, frame, "v", &vBuffer, &vStride)) return env.Undefined();

    if (width <= 0 || height <= 0) {
        Napi::RangeError::New(env, "VideoFrameInput width and height must be positive")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // I420 chroma planes are subsampled 2x in each dimension, so odd dimensions
    // have no well-defined chroma plane size.
    if ((width & 1) || (height & 1)) {
        Napi::RangeError::New(env, "VideoFrameInput width and height must be even")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if ((expectedWidth_ && width != expectedWidth_) ||
        (expectedHeight_ && height != expectedHeight_)) {
        Napi::RangeError::New(env,
            "VideoFrameInput dimensions do not match the track's configured source size")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

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

    // Microseconds as a plain JS number: exact for ~285 years at this
    // resolution, and the engine reports microseconds natively.
    int64_t timestampUs;
    if (frame.Has("timestamp") && !frame.Get("timestamp").IsUndefined()) {
        Napi::Value tsVal = frame.Get("timestamp");
        if (!tsVal.IsNumber()) {
            Napi::TypeError::New(env, "VideoFrameInput.timestamp must be a number (microseconds)")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
        double ts = tsVal.As<Napi::Number>().DoubleValue();
        if (!std::isfinite(ts) || ts != std::trunc(ts)) {
            Napi::RangeError::New(env, "VideoFrameInput.timestamp must be a whole number of microseconds")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
        if (ts < 0) {
            Napi::RangeError::New(env, "VideoFrameInput.timestamp must be non-negative")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
        if (ts > 9007199254740991.0) {
            Napi::RangeError::New(env, "VideoFrameInput.timestamp exceeds Number.MAX_SAFE_INTEGER")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
        timestampUs = static_cast<int64_t>(ts);
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

    // Copied synchronously: the caller may reuse or free these buffers as soon
    // as write() returns.
    auto i420Buffer = webrtc::I420Buffer::Copy(
        width, height,
        yBuffer.Data(), yStride,
        uBuffer.Data(), uStride,
        vBuffer.Data(), vStride);

    bool delivered = videoSource_->PushFrame(i420Buffer, timestampUs, rotation);
    if (delivered) {
        framesWritten_++;
        if (hasLastTimestamp_ && timestampUs <= lastTimestampUs_) timestampRegressions_++;
        hasLastTimestamp_ = true;
        lastTimestampUs_ = timestampUs;
    } else {
        framesDropped_++;
    }
    return Napi::Boolean::New(env, delivered);
}

Napi::Value LocalVideoTrackWrap::ConfigureSource(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsObject()) return env.Undefined();
    Napi::Object opts = info[0].As<Napi::Object>();
    int32_t w = 0, h = 0;
    if (opts.Has("width")) ToFiniteInt32(opts.Get("width"), &w);
    if (opts.Has("height")) ToFiniteInt32(opts.Get("height"), &h);
    expectedWidth_ = w > 0 ? w : 0;
    expectedHeight_ = h > 0 ? h : 0;
    return env.Undefined();
}

Napi::Value LocalVideoTrackWrap::GetWriteStats(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto out = Napi::Object::New(env);
    out.Set("framesWritten", Napi::Number::New(env, static_cast<double>(framesWritten_)));
    out.Set("framesDropped", Napi::Number::New(env, static_cast<double>(framesDropped_)));
    out.Set("timestampRegressions",
            Napi::Number::New(env, static_cast<double>(timestampRegressions_)));
    // Video publish is synchronous, so nothing is ever queued SDK-side.
    out.Set("sendQueueDepth", Napi::Number::New(env, 0));
    out.Set("maxQueue", Napi::Number::New(env, 0));
    if (hasLastTimestamp_) {
        out.Set("lastTimestamp", Napi::Number::New(env, static_cast<double>(lastTimestampUs_)));
    }
    return out;
}

}
