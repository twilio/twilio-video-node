#include "remote_video_track_wrap.h"
#include <webrtc/api/video/video_sink_interface.h>
#include <cmath>
#include <cstdint>

namespace twilio_video_node {

Napi::FunctionReference RemoteVideoTrackWrap::constructor_;

void RemoteVideoTrackWrap::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "RemoteVideoTrack", {
        InstanceAccessor("name", &RemoteVideoTrackWrap::GetName, nullptr),
        InstanceAccessor("kind", &RemoteVideoTrackWrap::GetKind, nullptr),
        InstanceAccessor("sid", &RemoteVideoTrackWrap::GetSid, nullptr),
        InstanceAccessor("enabled", &RemoteVideoTrackWrap::IsEnabled, nullptr),
        InstanceAccessor("isSwitchedOff", &RemoteVideoTrackWrap::IsSwitchedOff, nullptr),
        InstanceMethod("onFrame", &RemoteVideoTrackWrap::OnFrame),
        InstanceMethod("removeFrameCallback", &RemoteVideoTrackWrap::RemoveFrameCallback),
        InstanceMethod("setContentPreferences", &RemoteVideoTrackWrap::SetContentPreferences),
    });

    constructor_ = Napi::Persistent(func);
    constructor_.SuppressDestruct();
    exports.Set("RemoteVideoTrack", func);
}

Napi::Object RemoteVideoTrackWrap::NewInstance(Napi::Env env, std::shared_ptr<twilio::media::RemoteVideoTrack> track) {
    Napi::EscapableHandleScope scope(env);

    Napi::Object obj = constructor_.New({});
    RemoteVideoTrackWrap* wrap = Napi::ObjectWrap<RemoteVideoTrackWrap>::Unwrap(obj);
    wrap->track_ = track;

    return scope.Escape(obj).ToObject();
}

RemoteVideoTrackWrap::RemoteVideoTrackWrap(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<RemoteVideoTrackWrap>(info) {
}

RemoteVideoTrackWrap::~RemoteVideoTrackWrap() {
    detachSink();
}

void RemoteVideoTrackWrap::detachSink() {
    if (!frameSink_) return;

    auto webrtcTrack = track_ ? track_->getWebRtcTrack() : nullptr;
    if (webrtcTrack) {
        webrtcTrack->RemoveSink(frameSink_.get());
        frameSink_->close();
        frameSink_.reset();
        return;
    }

    // No track to unregister from, which happens once the Room has ended
    // remotely. Freeing the sink now would leave WebRTC's sink list dangling.
    frameSink_->close();
    (void)frameSink_.release();
}

Napi::Value RemoteVideoTrackWrap::GetKind(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), "video");
}

Napi::Value RemoteVideoTrackWrap::GetName(const Napi::CallbackInfo& info) {
    if (!track_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), track_->getName());
}

Napi::Value RemoteVideoTrackWrap::GetSid(const Napi::CallbackInfo& info) {
    if (!track_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), track_->getSid());
}

Napi::Value RemoteVideoTrackWrap::IsEnabled(const Napi::CallbackInfo& info) {
    if (!track_) return Napi::Boolean::New(info.Env(), false);
    return Napi::Boolean::New(info.Env(), track_->isEnabled());
}

Napi::Value RemoteVideoTrackWrap::IsSwitchedOff(const Napi::CallbackInfo& info) {
    if (!track_) return Napi::Boolean::New(info.Env(), false);
    return Napi::Boolean::New(info.Env(), track_->isSwitchedOff());
}

Napi::Value RemoteVideoTrackWrap::OnFrame(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Expected callback function").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    detachSink();

    auto callback = info[0].As<Napi::Function>();
    frameSink_ = std::make_unique<VideoFrameSink>(env, callback);

    if (track_) {
        auto webrtcTrack = track_->getWebRtcTrack();
        if (webrtcTrack) {
            rtc::VideoSinkWants wants;
            webrtcTrack->AddOrUpdateSink(frameSink_.get(), wants);
        }
    }

    return env.Undefined();
}

Napi::Value RemoteVideoTrackWrap::RemoveFrameCallback(const Napi::CallbackInfo& info) {
    detachSink();
    return info.Env().Undefined();
}

Napi::Value RemoteVideoTrackWrap::SetContentPreferences(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!track_) return env.Undefined();

    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "Expected preferences object").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    auto prefs = info[0].As<Napi::Object>();

    twilio::media::SinkHints hints;
    // Address the default sink rather than our OnFrame sink — content preferences apply to the track, not to a specific subscriber.
    hints.sink_id = twilio::media::kSinkIdWhenNoSinkAttachedToTrack;

    if (prefs.Has("renderDimensions")) {
        auto rdValue = prefs.Get("renderDimensions");
        if (!rdValue.IsObject()) {
            Napi::TypeError::New(env, "renderDimensions must be an object")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
        auto rd = rdValue.As<Napi::Object>();
        if (!rd.Has("width") || !rd.Has("height") ||
            !rd.Get("width").IsNumber() || !rd.Get("height").IsNumber()) {
            Napi::TypeError::New(env, "renderDimensions requires numeric width and height")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
        double w = rd.Get("width").As<Napi::Number>().DoubleValue();
        double h = rd.Get("height").As<Napi::Number>().DoubleValue();
        // Matches Number.MAX_SAFE_INTEGER (2^53 - 1).
        constexpr double kMaxSafe = 9007199254740991.0;
        auto isPositiveInt = [&](double v) {
            return std::isfinite(v) && v > 0 && v == std::floor(v) && v <= kMaxSafe;
        };
        if (!isPositiveInt(w) || !isPositiveInt(h)) {
            Napi::RangeError::New(env, "renderDimensions width and height must be positive integers")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
        twilio::video::VideoDimensions dims;
        dims.width = static_cast<uint64_t>(w);
        dims.height = static_cast<uint64_t>(h);

        twilio::media::VideoContentPreferences cp;
        cp.render_dimensions = dims;
        hints.content_preferences = cp;
    }

    try {
        track_->addSinkHints(hints);
    } catch (const std::exception& e) {
        // Use Error, not TypeError: bad arguments are already rejected with TypeError/RangeError
        // above, so anything reaching here is a runtime failure, not bad input.
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Undefined();
    }
    return env.Undefined();
}

}
