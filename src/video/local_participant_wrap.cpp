#include "local_participant_wrap.h"
#include "../media/local_video_track_wrap.h"
#include "../media/local_audio_track_wrap.h"
#include "../media/local_data_track_wrap.h"

namespace twilio_video_node {

Napi::FunctionReference LocalParticipantWrap::constructor_;

void LocalParticipantWrap::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "LocalParticipant", {
        InstanceAccessor("identity", &LocalParticipantWrap::GetIdentity, nullptr),
        InstanceAccessor("sid", &LocalParticipantWrap::GetSid, nullptr),
        InstanceAccessor("signalingRegion", &LocalParticipantWrap::GetSignalingRegion, nullptr),
        InstanceAccessor("videoTracks", &LocalParticipantWrap::GetVideoTracks, nullptr),
        InstanceAccessor("audioTracks", &LocalParticipantWrap::GetAudioTracks, nullptr),
        InstanceAccessor("dataTracks", &LocalParticipantWrap::GetDataTracks, nullptr),
        InstanceMethod("publishTrack", &LocalParticipantWrap::PublishTrack),
        InstanceMethod("unpublishTrack", &LocalParticipantWrap::UnpublishTrack),
    });

    constructor_ = Napi::Persistent(func);
    constructor_.SuppressDestruct();
    exports.Set("LocalParticipant", func);
}

Napi::Object LocalParticipantWrap::NewInstance(Napi::Env env, std::shared_ptr<twilio::video::LocalParticipant> participant) {
    Napi::EscapableHandleScope scope(env);

    Napi::Object obj = constructor_.New({});
    LocalParticipantWrap* wrap = Napi::ObjectWrap<LocalParticipantWrap>::Unwrap(obj);
    wrap->participant_ = participant;

    return scope.Escape(obj).ToObject();
}

LocalParticipantWrap::LocalParticipantWrap(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<LocalParticipantWrap>(info) {
}

LocalParticipantWrap::~LocalParticipantWrap() {
}

Napi::Value LocalParticipantWrap::GetIdentity(const Napi::CallbackInfo& info) {
    if (!participant_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), participant_->getIdentity());
}

Napi::Value LocalParticipantWrap::GetSid(const Napi::CallbackInfo& info) {
    if (!participant_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), participant_->getSid());
}

Napi::Value LocalParticipantWrap::GetSignalingRegion(const Napi::CallbackInfo& info) {
    if (!participant_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), participant_->getSignalingRegion());
}

Napi::Value LocalParticipantWrap::GetVideoTracks(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!participant_) return Napi::Array::New(env, 0);

    auto publications = participant_->getLocalVideoTracks();
    auto array = Napi::Array::New(env, publications.size());

    uint32_t i = 0;
    for (const auto& pub : publications) {
        auto obj = Napi::Object::New(env);
        obj.Set("trackSid", Napi::String::New(env, pub->getTrackSid()));
        obj.Set("trackName", Napi::String::New(env, pub->getTrackName()));
        array.Set(i++, obj);
    }

    return array;
}

Napi::Value LocalParticipantWrap::GetAudioTracks(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!participant_) return Napi::Array::New(env, 0);

    auto publications = participant_->getLocalAudioTracks();
    auto array = Napi::Array::New(env, publications.size());

    uint32_t i = 0;
    for (const auto& pub : publications) {
        auto obj = Napi::Object::New(env);
        obj.Set("trackSid", Napi::String::New(env, pub->getTrackSid()));
        obj.Set("trackName", Napi::String::New(env, pub->getTrackName()));
        array.Set(i++, obj);
    }

    return array;
}

Napi::Value LocalParticipantWrap::GetDataTracks(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!participant_) return Napi::Array::New(env, 0);

    auto publications = participant_->getLocalDataTracks();
    auto array = Napi::Array::New(env, publications.size());

    uint32_t i = 0;
    for (const auto& pub : publications) {
        auto obj = Napi::Object::New(env);
        obj.Set("trackSid", Napi::String::New(env, pub->getTrackSid()));
        obj.Set("trackName", Napi::String::New(env, pub->getTrackName()));
        array.Set(i++, obj);
    }

    return array;
}

Napi::Value LocalParticipantWrap::PublishTrack(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!participant_ || info.Length() < 1 || !info[0].IsObject()) {
        return Napi::Boolean::New(env, false);
    }

    auto trackObj = info[0].As<Napi::Object>();

    auto* videoTrack = Napi::ObjectWrap<LocalVideoTrackWrap>::Unwrap(trackObj);
    if (videoTrack) {
        bool result = participant_->publishTrack(videoTrack->getTrack());
        return Napi::Boolean::New(env, result);
    }

    auto* audioTrack = Napi::ObjectWrap<LocalAudioTrackWrap>::Unwrap(trackObj);
    if (audioTrack) {
        bool result = participant_->publishTrack(audioTrack->getTrack());
        return Napi::Boolean::New(env, result);
    }

    auto* dataTrack = Napi::ObjectWrap<LocalDataTrackWrap>::Unwrap(trackObj);
    if (dataTrack) {
        bool result = participant_->publishTrack(dataTrack->getTrack());
        return Napi::Boolean::New(env, result);
    }

    return Napi::Boolean::New(env, false);
}

Napi::Value LocalParticipantWrap::UnpublishTrack(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!participant_ || info.Length() < 1 || !info[0].IsObject()) {
        return Napi::Boolean::New(env, false);
    }

    auto trackObj = info[0].As<Napi::Object>();

    auto* videoTrack = Napi::ObjectWrap<LocalVideoTrackWrap>::Unwrap(trackObj);
    if (videoTrack) {
        bool result = participant_->unpublishTrack(videoTrack->getTrack());
        return Napi::Boolean::New(env, result);
    }

    auto* audioTrack = Napi::ObjectWrap<LocalAudioTrackWrap>::Unwrap(trackObj);
    if (audioTrack) {
        bool result = participant_->unpublishTrack(audioTrack->getTrack());
        return Napi::Boolean::New(env, result);
    }

    auto* dataTrack = Napi::ObjectWrap<LocalDataTrackWrap>::Unwrap(trackObj);
    if (dataTrack) {
        bool result = participant_->unpublishTrack(dataTrack->getTrack());
        return Napi::Boolean::New(env, result);
    }

    return Napi::Boolean::New(env, false);
}

}
