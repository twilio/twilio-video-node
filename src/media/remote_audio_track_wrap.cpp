#include "remote_audio_track_wrap.h"

namespace twilio_video_node {

Napi::FunctionReference RemoteAudioTrackWrap::constructor_;

void RemoteAudioTrackWrap::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "RemoteAudioTrack", {
        InstanceAccessor("name", &RemoteAudioTrackWrap::GetName, nullptr),
        InstanceAccessor("sid", &RemoteAudioTrackWrap::GetSid, nullptr),
        InstanceAccessor("enabled", &RemoteAudioTrackWrap::IsEnabled, nullptr),
        InstanceMethod("onData", &RemoteAudioTrackWrap::OnData),
        InstanceMethod("removeDataCallback", &RemoteAudioTrackWrap::RemoveDataCallback),
    });

    constructor_ = Napi::Persistent(func);
    constructor_.SuppressDestruct();
    exports.Set("RemoteAudioTrack", func);
}

Napi::Object RemoteAudioTrackWrap::NewInstance(Napi::Env env, std::shared_ptr<twilio::media::RemoteAudioTrack> track) {
    Napi::EscapableHandleScope scope(env);

    Napi::Object obj = constructor_.New({});
    RemoteAudioTrackWrap* wrap = Napi::ObjectWrap<RemoteAudioTrackWrap>::Unwrap(obj);
    wrap->track_ = track;

    return scope.Escape(obj).ToObject();
}

RemoteAudioTrackWrap::RemoteAudioTrackWrap(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<RemoteAudioTrackWrap>(info) {
}

RemoteAudioTrackWrap::~RemoteAudioTrackWrap() {
    if (audioSink_ && track_) {
        auto webrtcTrack = track_->getWebRtcTrack();
        if (webrtcTrack) {
            webrtcTrack->RemoveSink(audioSink_.get());
        }
        audioSink_->close();
    }
}

Napi::Value RemoteAudioTrackWrap::GetName(const Napi::CallbackInfo& info) {
    if (!track_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), track_->getName());
}

Napi::Value RemoteAudioTrackWrap::GetSid(const Napi::CallbackInfo& info) {
    if (!track_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), track_->getSid());
}

Napi::Value RemoteAudioTrackWrap::IsEnabled(const Napi::CallbackInfo& info) {
    if (!track_) return Napi::Boolean::New(info.Env(), false);
    return Napi::Boolean::New(info.Env(), track_->isEnabled());
}

Napi::Value RemoteAudioTrackWrap::OnData(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Expected callback function").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (audioSink_ && track_) {
        auto webrtcTrack = track_->getWebRtcTrack();
        if (webrtcTrack) {
            webrtcTrack->RemoveSink(audioSink_.get());
        }
        audioSink_->close();
    }

    auto callback = info[0].As<Napi::Function>();
    audioSink_ = std::make_unique<AudioFrameSink>(env, callback);

    if (track_) {
        auto webrtcTrack = track_->getWebRtcTrack();
        if (webrtcTrack) {
            webrtcTrack->AddSink(audioSink_.get());
        }
    }

    return env.Undefined();
}

Napi::Value RemoteAudioTrackWrap::RemoveDataCallback(const Napi::CallbackInfo& info) {
    if (audioSink_ && track_) {
        auto webrtcTrack = track_->getWebRtcTrack();
        if (webrtcTrack) {
            webrtcTrack->RemoveSink(audioSink_.get());
        }
        audioSink_->close();
        audioSink_.reset();
    }
    return info.Env().Undefined();
}

}
