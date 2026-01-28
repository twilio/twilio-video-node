#include "room_observer_wrap.h"
#include "room_wrap.h"
#include "remote_participant_wrap.h"
#include "../common/error.h"

namespace twilio_video_node {

RoomObserverWrap::RoomObserverWrap(Napi::Env env, RoomWrap* roomWrap)
    : roomWrap_(roomWrap)
    , asyncContext_(std::make_unique<AsyncContext>(env)) {
    fprintf(stderr, "[C++] RoomObserverWrap::RoomObserverWrap() - created at %p\n", this);
}

RoomObserverWrap::~RoomObserverWrap() {
    fprintf(stderr, "[C++] RoomObserverWrap::~RoomObserverWrap() - destroying at %p\n", this);
    close();
}

void RoomObserverWrap::close() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (closed_) return;
    closed_ = true;
    if (asyncContext_) {
        asyncContext_->close();
    }
}

void RoomObserverWrap::dispatchEvent(const std::string& eventName, std::function<Napi::Value(Napi::Env)> createArgs) {
    std::lock_guard<std::mutex> lock(mutex_);
    fprintf(stderr, "[C++] dispatchEvent('%s') - closed=%d, asyncContext=%p, roomWrap=%p\n",
            eventName.c_str(), closed_, asyncContext_.get(), roomWrap_);
    if (closed_ || !asyncContext_ || !roomWrap_) {
        fprintf(stderr, "[C++] dispatchEvent('%s') - SKIPPED due to null check\n", eventName.c_str());
        return;
    }

    asyncContext_->dispatch([this, eventName, createArgs](Napi::Env env) {
        fprintf(stderr, "[C++] dispatchEvent('%s') - executing on JS thread\n", eventName.c_str());
        if (closed_ || !roomWrap_) {
            fprintf(stderr, "[C++] dispatchEvent('%s') - SKIPPED in lambda\n", eventName.c_str());
            return;
        }

        // HandleScope already created in AsyncContext::drain(), but add here for clarity
        Napi::Value arg = createArgs ? createArgs(env) : env.Undefined();
        fprintf(stderr, "[C++] dispatchEvent('%s') - calling roomWrap->emitEvent()\n", eventName.c_str());
        roomWrap_->emitEvent(eventName, arg);
        fprintf(stderr, "[C++] dispatchEvent('%s') - emitEvent() completed\n", eventName.c_str());
    });
}

void RoomObserverWrap::onConnected(twilio::video::Room* room) {
    fprintf(stderr, "[C++] onConnected callback invoked for room: %s\n", room ? room->getName().c_str() : "null");
    dispatchEvent("connected");
    fprintf(stderr, "[C++] dispatchEvent('connected') completed\n");
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
    fprintf(stderr, "[C++] onConnectFailure callback invoked: %s (code: %d)\n", error.getMessage().c_str(), error.getCode());
    dispatchEvent("connectFailure", [error](Napi::Env env) -> Napi::Value {
        return createTwilioErrorObject(env, error.getCode(), error.getMessage());
    });
    fprintf(stderr, "[C++] dispatchEvent('connectFailure') completed\n");
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
    fprintf(stderr, "[C++] onParticipantConnected callback invoked - participant: %s (%s)\n",
            participant ? participant->getIdentity().c_str() : "null",
            participant ? participant->getSid().c_str() : "null");
    dispatchEvent("participantConnected", [participant](Napi::Env env) -> Napi::Value {
        fprintf(stderr, "[C++] Creating RemoteParticipantWrap for JS...\n");
        return RemoteParticipantWrap::NewInstance(env, participant);
    });
    fprintf(stderr, "[C++] dispatchEvent('participantConnected') completed\n");
}

void RoomObserverWrap::onParticipantDisconnected(twilio::video::Room* room, std::shared_ptr<twilio::video::RemoteParticipant> participant) {
    fprintf(stderr, "[C++] onParticipantDisconnected callback invoked - participant: %s (%s)\n",
            participant ? participant->getIdentity().c_str() : "null",
            participant ? participant->getSid().c_str() : "null");
    dispatchEvent("participantDisconnected", [participant](Napi::Env env) -> Napi::Value {
        return RemoteParticipantWrap::NewInstance(env, participant);
    });
    fprintf(stderr, "[C++] dispatchEvent('participantDisconnected') completed\n");
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
    fprintf(stderr, "[C++] onDominantSpeakerChanged callback invoked - participant: %s\n",
            participant ? participant->getIdentity().c_str() : "null");
    dispatchEvent("dominantSpeakerChanged", [participant](Napi::Env env) -> Napi::Value {
        if (participant) {
            return RemoteParticipantWrap::NewInstance(env, participant);
        }
        return env.Null();
    });
    fprintf(stderr, "[C++] dispatchEvent('dominantSpeakerChanged') completed\n");
}

}
