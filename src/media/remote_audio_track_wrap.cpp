#include "remote_audio_track_wrap.h"

namespace twilio_video_node {

Napi::FunctionReference RemoteAudioTrackWrap::constructor_;

void RemoteAudioTrackWrap::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "RemoteAudioTrack", {
        InstanceAccessor("name", &RemoteAudioTrackWrap::GetName, nullptr),
        InstanceAccessor("kind", &RemoteAudioTrackWrap::GetKind, nullptr),
        InstanceAccessor("sid", &RemoteAudioTrackWrap::GetSid, nullptr),
        InstanceAccessor("enabled", &RemoteAudioTrackWrap::IsEnabled, nullptr),
        InstanceMethod("_attachFrameSink", &RemoteAudioTrackWrap::AttachFrameSink),
        InstanceMethod("_detachFrameSink", &RemoteAudioTrackWrap::DetachFrameSink),
        InstanceMethod("_sinkStats", &RemoteAudioTrackWrap::SinkStats),
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
    detachSink();
}

void RemoteAudioTrackWrap::detachSink() {
    if (!audioSink_) return;

    auto webrtcTrack = track_ ? track_->getWebRtcTrack() : nullptr;
    if (webrtcTrack) {
        webrtcTrack->RemoveSink(audioSink_.get());
        audioSink_->close();
        audioSink_.reset();
        return;
    }

    // No track to unregister from, which happens once the Room has ended
    // remotely. Freeing the sink now would leave WebRTC's sink list dangling.
    audioSink_->close();
    (void)audioSink_.release();
}

Napi::Value RemoteAudioTrackWrap::GetKind(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), "audio");
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

Napi::Value RemoteAudioTrackWrap::AttachFrameSink(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Expected callback function").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    size_t depth = AsyncContext::kDefaultMaxQueueDepth;
    if (info.Length() > 1 && info[1].IsNumber()) {
        double d = info[1].As<Napi::Number>().DoubleValue();
        if (d >= 1 && d <= 1024) depth = static_cast<size_t>(d);
    }

    detachSink();

    auto callback = info[0].As<Napi::Function>();
    audioSink_ = std::make_unique<AudioFrameSink>(env, callback, depth);

    if (track_) {
        auto webrtcTrack = track_->getWebRtcTrack();
        if (webrtcTrack) {
            webrtcTrack->AddSink(audioSink_.get());
        }
    }

    return env.Undefined();
}

Napi::Value RemoteAudioTrackWrap::SinkStats(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto out = Napi::Object::New(env);
    out.Set("nativeDropped",
            Napi::Number::New(env, audioSink_ ? static_cast<double>(audioSink_->droppedCount()) : 0));
    out.Set("nativeQueueDepth",
            Napi::Number::New(env, audioSink_ ? static_cast<double>(audioSink_->queueDepth()) : 0));
    return out;
}

Napi::Value RemoteAudioTrackWrap::DetachFrameSink(const Napi::CallbackInfo& info) {
    detachSink();
    return info.Env().Undefined();
}

}
