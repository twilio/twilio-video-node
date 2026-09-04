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
#include <functional>

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
     * Runs `fn` on the JS thread strictly after every event already queued for
     * `observer`'s participant, including any trackUnsubscribed raised as part
     * of the same teardown. Two independent AsyncContext queues give no
     * ordering guarantee relative to each other, so an event that must arrive
     * last for a participant needs to go through the participant's own queue
     * rather than a separate one.
     */
    static void DispatchAfterPendingEvents(std::shared_ptr<RemoteParticipantObserverImpl> observer,
                                           std::function<void(Napi::Env)> fn);

    /**
     * Permanently stops `observer` and releases anything it has buffered. Only
     * for a caller that owns the observer's registration and is giving it up,
     * such as the Room tearing down: a bound wrap does this from its own
     * destructor.
     */
    static void CloseObserver(const std::shared_ptr<RemoteParticipantObserverImpl>& observer);

    /**
     * Whether `observer` has been closed and can no longer deliver anything.
     * A wrap closes the observer it owns when it is collected, so a registry
     * holding observers needs this to tell a reusable registration from a dead
     * one.
     */
    static bool IsObserverClosed(const std::shared_ptr<RemoteParticipantObserverImpl>& observer);

    /**
     * Builds the JS wrap. Must run on the JS thread.
     *
     * Always pass the observer from RoomObserverWrap::GetOrCreateParticipantObserver
     * so an already-known participant reuses its existing observer rather than
     * getting a new, conflicting one. The nullptr default exists only as a
     * fallback for a genuinely new participant with no registration yet; every
     * call site in this codebase passes an observer explicitly.
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
    // Whether this wrap's constructor call to observer_->bind() actually won
    // the binding, versus another wrap for the same participant already
    // holding it. Only the winner may detach or close the observer on teardown.
    bool ownsObserverBinding_ = false;
};

}
