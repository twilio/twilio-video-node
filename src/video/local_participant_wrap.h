#pragma once

#include <napi.h>
#include <twilio/video/local_participant.h>

namespace twilio_video_node {

class LocalParticipantWrap : public Napi::ObjectWrap<LocalParticipantWrap> {
public:
    static void Init(Napi::Env env, Napi::Object exports);
    static Napi::Object NewInstance(Napi::Env env, std::shared_ptr<twilio::video::LocalParticipant> participant);

    LocalParticipantWrap(const Napi::CallbackInfo& info);
    ~LocalParticipantWrap();

private:
    static Napi::FunctionReference constructor_;

    Napi::Value GetIdentity(const Napi::CallbackInfo& info);
    Napi::Value GetSid(const Napi::CallbackInfo& info);
    Napi::Value GetSignalingRegion(const Napi::CallbackInfo& info);
    Napi::Value GetVideoTracks(const Napi::CallbackInfo& info);
    Napi::Value GetAudioTracks(const Napi::CallbackInfo& info);
    Napi::Value GetDataTracks(const Napi::CallbackInfo& info);
    Napi::Value PublishTrack(const Napi::CallbackInfo& info);
    Napi::Value UnpublishTrack(const Napi::CallbackInfo& info);

    std::shared_ptr<twilio::video::LocalParticipant> participant_;
};

}
