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

private:
    void dispatchEvent(const std::string& eventName, std::function<Napi::Value(Napi::Env)> createArgs = nullptr);

    RoomWrap* roomWrap_;
    std::unique_ptr<AsyncContext> asyncContext_;
    std::atomic<bool> closed_{false};
    std::mutex mutex_;

    // Keyed by participant SID. onParticipantConnected creates the observer and
    // registers it here. onParticipantDisconnected reuses the same one instead
    // of installing a second, unbound observer on the same native participant,
    // which would replace the observer the live JS wrap is bound to.
    std::mutex participantObserversMutex_;
    std::unordered_map<std::string, std::shared_ptr<RemoteParticipantObserverImpl>> participantObservers_;
};

}
