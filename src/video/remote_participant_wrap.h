#pragma once

#include <napi.h>
#include <twilio/video/remote_participant.h>
#include <twilio/video/network_quality.h>

// WORKAROUND: Include track.h BEFORE remote_participant_observer.h
// This defines media::TrackPriority which remote_participant_observer.h references but doesn't include
#include <twilio/media/track.h>

#include <twilio/video/remote_participant_observer.h>
#include "../common/async_context.h"
#include <memory>

namespace twilio_video_node {

class RemoteParticipantObserverImpl;

class RemoteParticipantWrap : public Napi::ObjectWrap<RemoteParticipantWrap> {
public:
    static void Init(Napi::Env env, Napi::Object exports);

    /**
     * Creates the rtc-cpp observer for `participant` and installs it immediately.
     *
     * Safe to call from any thread: it touches no JS state. Events raised before
     * the matching NewInstance() call are buffered by the observer and flushed
     * when the wrap binds to it. rtc-cpp raises track subscriptions within a
     * millisecond of onParticipantConnected, so installing the observer only
     * once the JS thread has built the wrap loses those events outright.
     */
    static std::shared_ptr<RemoteParticipantObserverImpl> CreateObserver(
        std::shared_ptr<twilio::video::RemoteParticipant> participant);

    /**
     * Builds the JS wrap. Must run on the JS thread.
     *
     * Pass the observer returned by CreateObserver() to adopt it along with any
     * events it buffered; pass nullptr to create and install one here, which is
     * only correct when the participant is already known to the room.
     */
    static Napi::Object NewInstance(Napi::Env env, std::shared_ptr<twilio::video::RemoteParticipant> participant,
                                    std::shared_ptr<RemoteParticipantObserverImpl> observer = nullptr);

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
    std::shared_ptr<std::atomic<bool>> alive_ = std::make_shared<std::atomic<bool>>(true);
};

}
