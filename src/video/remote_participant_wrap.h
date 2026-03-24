#pragma once

#include <napi.h>
#include <twilio/video/remote_participant.h>
#include <twilio/video/network_quality.h>

// WORKAROUND: Include track.h BEFORE remote_participant_observer.h
// This defines media::TrackPriority which remote_participant_observer.h references but doesn't include
#include <twilio/media/track.h>

#include <twilio/video/remote_participant_observer.h>
#include "../common/async_context.h"

namespace twilio_video_node {

class RemoteParticipantObserverImpl;

class RemoteParticipantWrap : public Napi::ObjectWrap<RemoteParticipantWrap> {
public:
    static void Init(Napi::Env env, Napi::Object exports);
    static Napi::Object NewInstance(Napi::Env env, std::shared_ptr<twilio::video::RemoteParticipant> participant);

    RemoteParticipantWrap(const Napi::CallbackInfo& info);
    ~RemoteParticipantWrap();

    void emitEvent(const std::string& eventName, Napi::Value arg = Napi::Value());
    std::shared_ptr<twilio::video::RemoteParticipant> getParticipant() const { return participant_; }

private:
    Napi::FunctionReference eventCallback_;
    static Napi::FunctionReference constructor_;

    Napi::Value GetIdentity(const Napi::CallbackInfo& info);
    Napi::Value GetSid(const Napi::CallbackInfo& info);
    Napi::Value GetState(const Napi::CallbackInfo& info);
    Napi::Value GetNetworkQualityLevel(const Napi::CallbackInfo& info);
    Napi::Value GetVideoTracks(const Napi::CallbackInfo& info);
    Napi::Value GetAudioTracks(const Napi::CallbackInfo& info);
    Napi::Value GetDataTracks(const Napi::CallbackInfo& info);
    Napi::Value SetEventCallback(const Napi::CallbackInfo& info);

    std::shared_ptr<twilio::video::RemoteParticipant> participant_;
    std::shared_ptr<RemoteParticipantObserverImpl> observer_;
    std::unique_ptr<AsyncContext> asyncContext_;
};

}
