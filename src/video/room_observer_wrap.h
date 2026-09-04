#pragma once

#include <napi.h>
#include <twilio/video/room_observer.h>
#include <twilio/video/room.h>
#include <twilio/video/remote_participant.h>
#include "../common/async_context.h"
#include <functional>
#include <atomic>
#include <unordered_map>
#include <string>

namespace twilio_video_node {

class RoomWrap;
class RemoteParticipantObserverImpl;

class RoomObserverWrap : public twilio::video::RoomObserver,
                         public std::enable_shared_from_this<RoomObserverWrap> {
public:
    RoomObserverWrap(Napi::Env env, RoomWrap* roomWrap);
    ~RoomObserverWrap();

    void onConnected(twilio::video::Room* room) override;
    void onDisconnected(const twilio::video::Room* room, std::unique_ptr<twilio::video::Error> error) override;
    void onConnectFailure(const twilio::video::Room* room, const twilio::video::Error error) override;
    void onReconnecting(const twilio::video::Room* room, const twilio::video::Error error) override;
    void onReconnected(const twilio::video::Room* room) override;
    void onParticipantConnected(twilio::video::Room* room, std::shared_ptr<twilio::video::RemoteParticipant> participant) override;
    void onParticipantDisconnected(twilio::video::Room* room, std::shared_ptr<twilio::video::RemoteParticipant> participant) override;
    void onParticipantReconnecting(const twilio::video::Room* room, std::shared_ptr<twilio::video::RemoteParticipant> participant) override;
    void onParticipantReconnected(const twilio::video::Room* room, std::shared_ptr<twilio::video::RemoteParticipant> participant) override;
    void onRecordingStarted(twilio::video::Room* room) override;
    void onRecordingStopped(twilio::video::Room* room) override;
    void onDominantSpeakerChanged(const twilio::video::Room* room, std::shared_ptr<twilio::video::RemoteParticipant> participant) override;
    void onTranscription(const twilio::video::Room* room, const std::string& transcriptionJson) override;

    void close();

    /**
     * Returns the observer already registered for this participant's SID, or
     * creates and registers one. Every code path that can hand a
     * RemoteParticipant to JS (the onParticipant... and
     * onDominantSpeakerChanged callbacks below, plus
     * RoomWrap::GetRemoteParticipants and RoomWrap::GetDominantSpeaker) must
     * call this instead of RemoteParticipantWrap::CreateObserver directly. A
     * native participant has exactly one live observer at a time; creating a
     * second one for the same participant replaces the first, which silently
     * stops event delivery to whichever JS wrap the first observer was bound to.
     */
    std::shared_ptr<RemoteParticipantObserverImpl> GetOrCreateParticipantObserver(
        std::shared_ptr<twilio::video::RemoteParticipant> participant);

    /** Drops the registration for a participant's SID once they have disconnected. */
    void ForgetParticipantObserver(const std::string& sid);

private:
    void dispatchEvent(const std::string& eventName, std::function<Napi::Value(Napi::Env)> createArgs = nullptr);

    RoomWrap* roomWrap_;
    std::unique_ptr<AsyncContext> asyncContext_;
    std::atomic<bool> closed_{false};
    std::mutex mutex_;

    std::mutex participantObserversMutex_;
    std::unordered_map<std::string, std::shared_ptr<RemoteParticipantObserverImpl>> participantObservers_;
};

}
