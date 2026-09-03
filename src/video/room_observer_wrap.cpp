#include "room_observer_wrap.h"
#include "room_wrap.h"
#include "remote_participant_wrap.h"
#include "../common/error.h"

namespace twilio_video_node {

RoomObserverWrap::RoomObserverWrap(Napi::Env env, RoomWrap* roomWrap)
    : roomWrap_(roomWrap)
    , asyncContext_(std::make_unique<AsyncContext>(env, 0)) {
    // queue depth 0 = unlimited for events (events must not be dropped)
}

RoomObserverWrap::~RoomObserverWrap() {
    close();
}

void RoomObserverWrap::close() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_.load(std::memory_order_acquire)) return;
        closed_.store(true, std::memory_order_release);
        roomWrap_ = nullptr;
    }
    if (asyncContext_) {
        asyncContext_->close();
        asyncContext_.reset();
    }
}

void RoomObserverWrap::dispatchEvent(const std::string& eventName, std::function<Napi::Value(Napi::Env)> createArgs) {
    if (closed_.load(std::memory_order_acquire)) return;

    std::lock_guard<std::mutex> lock(mutex_);
    if (closed_.load(std::memory_order_acquire) || !asyncContext_ || !roomWrap_) {
        return;
    }

    asyncContext_->dispatch([this, eventName, createArgs](Napi::Env env) {
        if (closed_.load(std::memory_order_acquire) || !roomWrap_) return;

        Napi::Value arg = createArgs ? createArgs(env) : env.Undefined();
        roomWrap_->emitEvent(eventName, arg);
    });
}

void RoomObserverWrap::onConnected(twilio::video::Room* room) {
    dispatchEvent("connected");
}

void RoomObserverWrap::onDisconnected(const twilio::video::Room* room, std::unique_ptr<twilio::video::Error> error) {
    dispatchEvent("disconnected", [error = error ? std::make_shared<twilio::video::Error>(*error) : nullptr](Napi::Env env) -> Napi::Value {
        if (error) {
            return createTwilioErrorObject(env, error->getCode(), error->getMessage());
        }
        return env.Undefined();
    });
}

void RoomObserverWrap::onConnectFailure(const twilio::video::Room* room, const twilio::video::Error error) {
    dispatchEvent("connectFailure", [error](Napi::Env env) -> Napi::Value {
        return createTwilioErrorObject(env, error.getCode(), error.getMessage());
    });
}

void RoomObserverWrap::onReconnecting(const twilio::video::Room* room, const twilio::video::Error error) {
    dispatchEvent("reconnecting", [error](Napi::Env env) -> Napi::Value {
        return createTwilioErrorObject(env, error.getCode(), error.getMessage());
    });
}

void RoomObserverWrap::onReconnected(const twilio::video::Room* room) {
    dispatchEvent("reconnected");
}

void RoomObserverWrap::onParticipantConnected(twilio::video::Room* room, std::shared_ptr<twilio::video::RemoteParticipant> participant) {
    // Install the observer here, on the signaling thread, rather than inside the
    // dispatched lambda: rtc-cpp subscribes to the participant's tracks about a
    // millisecond after this callback, which is well inside the hop to the JS
    // thread. Events raised in that window are buffered and replayed by bind().
    auto observer = RemoteParticipantWrap::CreateObserver(participant);
    dispatchEvent("participantConnected", [participant, observer](Napi::Env env) -> Napi::Value {
        return RemoteParticipantWrap::NewInstance(env, participant, observer);
    });
}

void RoomObserverWrap::onParticipantDisconnected(twilio::video::Room* room, std::shared_ptr<twilio::video::RemoteParticipant> participant) {
    dispatchEvent("participantDisconnected", [participant](Napi::Env env) -> Napi::Value {
        return RemoteParticipantWrap::NewInstance(env, participant);
    });
}

void RoomObserverWrap::onParticipantReconnecting(const twilio::video::Room* room, std::shared_ptr<twilio::video::RemoteParticipant> participant) {
    dispatchEvent("participantReconnecting", [participant](Napi::Env env) -> Napi::Value {
        return RemoteParticipantWrap::NewInstance(env, participant);
    });
}

void RoomObserverWrap::onParticipantReconnected(const twilio::video::Room* room, std::shared_ptr<twilio::video::RemoteParticipant> participant) {
    dispatchEvent("participantReconnected", [participant](Napi::Env env) -> Napi::Value {
        return RemoteParticipantWrap::NewInstance(env, participant);
    });
}

void RoomObserverWrap::onRecordingStarted(twilio::video::Room* room) {
    dispatchEvent("recordingStarted");
}

void RoomObserverWrap::onRecordingStopped(twilio::video::Room* room) {
    dispatchEvent("recordingStopped");
}

void RoomObserverWrap::onDominantSpeakerChanged(const twilio::video::Room* room, std::shared_ptr<twilio::video::RemoteParticipant> participant) {
    dispatchEvent("dominantSpeakerChanged", [participant](Napi::Env env) -> Napi::Value {
        if (participant) {
            return RemoteParticipantWrap::NewInstance(env, participant);
        }
        return env.Null();
    });
}

void RoomObserverWrap::onTranscription(const twilio::video::Room* room, const std::string& transcriptionJson) {
    auto json = transcriptionJson;
    dispatchEvent("transcription", [json = std::move(json)](Napi::Env env) -> Napi::Value {
        return Napi::String::New(env, json);
    });
}

}
