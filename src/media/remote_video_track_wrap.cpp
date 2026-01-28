#include "remote_video_track_wrap.h"
#include <webrtc/api/video/video_sink_interface.h>

namespace twilio_video_node {

Napi::FunctionReference RemoteVideoTrackWrap::constructor_;

void RemoteVideoTrackWrap::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "RemoteVideoTrack", {
        InstanceAccessor("name", &RemoteVideoTrackWrap::GetName, nullptr),
        InstanceAccessor("sid", &RemoteVideoTrackWrap::GetSid, nullptr),
        InstanceAccessor("enabled", &RemoteVideoTrackWrap::IsEnabled, nullptr),
        InstanceAccessor("isSwitchedOff", &RemoteVideoTrackWrap::IsSwitchedOff, nullptr),
        InstanceMethod("onFrame", &RemoteVideoTrackWrap::OnFrame),
        InstanceMethod("removeFrameCallback", &RemoteVideoTrackWrap::RemoveFrameCallback),
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
    if (frameSink_ && track_) {
        auto webrtcTrack = track_->getWebRtcTrack();
        if (webrtcTrack) {
            webrtcTrack->RemoveSink(frameSink_.get());
        }
        frameSink_->close();
    }
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

    if (frameSink_ && track_) {
        auto webrtcTrack = track_->getWebRtcTrack();
        if (webrtcTrack) {
            webrtcTrack->RemoveSink(frameSink_.get());
        }
        frameSink_->close();
    }

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
    if (frameSink_ && track_) {
        auto webrtcTrack = track_->getWebRtcTrack();
        if (webrtcTrack) {
            webrtcTrack->RemoveSink(frameSink_.get());
        }
        frameSink_->close();
        frameSink_.reset();
    }
    return info.Env().Undefined();
}

}
