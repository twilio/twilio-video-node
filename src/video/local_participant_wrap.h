#pragma once

#include <napi.h>
#include <twilio/video/local_participant.h>
#include <twilio/video/local_participant_observer.h>
#include <twilio/video/network_quality.h>
#include <twilio/media/codec.h>
#include "../common/async_context.h"

namespace twilio_video_node {

class LocalParticipantObserverImpl;

class LocalParticipantWrap : public Napi::ObjectWrap<LocalParticipantWrap> {
public:
    static void Init(Napi::Env env, Napi::Object exports);
    static Napi::Object NewInstance(Napi::Env env, std::shared_ptr<twilio::video::LocalParticipant> participant);

    LocalParticipantWrap(const Napi::CallbackInfo& info);
    ~LocalParticipantWrap();

    void emitEvent(const std::string& eventName, Napi::Value arg = Napi::Value());

private:
    Napi::FunctionReference eventCallback_;
    static Napi::FunctionReference constructor_;

    Napi::Value GetIdentity(const Napi::CallbackInfo& info);
    Napi::Value GetSid(const Napi::CallbackInfo& info);
    Napi::Value GetState(const Napi::CallbackInfo& info);
    Napi::Value GetNetworkQualityLevel(const Napi::CallbackInfo& info);
    Napi::Value GetSignalingRegion(const Napi::CallbackInfo& info);
    Napi::Value GetVideoTracks(const Napi::CallbackInfo& info);
    Napi::Value GetAudioTracks(const Napi::CallbackInfo& info);
    Napi::Value GetDataTracks(const Napi::CallbackInfo& info);
    Napi::Value PublishTrack(const Napi::CallbackInfo& info);
    Napi::Value UnpublishTrack(const Napi::CallbackInfo& info);
    Napi::Value SetEncodingParameters(const Napi::CallbackInfo& info);
    Napi::Value SetEventCallback(const Napi::CallbackInfo& info);

    std::shared_ptr<twilio::video::LocalParticipant> participant_;
    std::shared_ptr<LocalParticipantObserverImpl> observer_;
    std::unique_ptr<AsyncContext> asyncContext_;
};

}
