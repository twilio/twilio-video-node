#include "local_audio_track_wrap.h"

namespace twilio_video_node {

Napi::FunctionReference LocalAudioTrackWrap::constructor_;

void LocalAudioTrackWrap::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "LocalAudioTrack", {
        InstanceAccessor("name", &LocalAudioTrackWrap::GetName, nullptr),
        InstanceAccessor("enabled", &LocalAudioTrackWrap::IsEnabled, &LocalAudioTrackWrap::SetEnabled),
    });

    constructor_ = Napi::Persistent(func);
    constructor_.SuppressDestruct();
    exports.Set("LocalAudioTrack", func);
}

Napi::Object LocalAudioTrackWrap::NewInstance(Napi::Env env,
                                               std::shared_ptr<twilio::media::MediaFactory> factory,
                                               const twilio::media::AudioTrackOptions& options) {
    Napi::EscapableHandleScope scope(env);

    auto track = factory->createAudioTrack(options);

    Napi::Object obj = constructor_.New({});
    LocalAudioTrackWrap* wrap = Napi::ObjectWrap<LocalAudioTrackWrap>::Unwrap(obj);
    wrap->track_ = track;
    wrap->factory_ = factory;

    return scope.Escape(obj).ToObject();
}

LocalAudioTrackWrap::LocalAudioTrackWrap(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<LocalAudioTrackWrap>(info) {
}

LocalAudioTrackWrap::~LocalAudioTrackWrap() {
}

Napi::Value LocalAudioTrackWrap::GetName(const Napi::CallbackInfo& info) {
    if (!track_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), track_->getName());
}

Napi::Value LocalAudioTrackWrap::IsEnabled(const Napi::CallbackInfo& info) {
    if (!track_) return Napi::Boolean::New(info.Env(), false);
    return Napi::Boolean::New(info.Env(), track_->isEnabled());
}

void LocalAudioTrackWrap::SetEnabled(const Napi::CallbackInfo& info, const Napi::Value& value) {
    if (!track_) return;
    track_->setEnabled(value.As<Napi::Boolean>().Value());
}

}
