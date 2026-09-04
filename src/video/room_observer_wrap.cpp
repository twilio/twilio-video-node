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
    {
        std::lock_guard<std::mutex> lock(participantObserversMutex_);
        participantObservers_.clear();
    }
    if (asyncContext_) {
        asyncContext_->close();
        asyncContext_.reset();
    }
}

std::shared_ptr<RemoteParticipantObserverImpl> RoomObserverWrap::GetOrCreateParticipantObserver(
    std::shared_ptr<twilio::video::RemoteParticipant> participant) {
    std::string sid = participant->getSid();

    std::lock_guard<std::mutex> lock(participantObserversMutex_);
    auto it = participantObservers_.find(sid);
    if (it != participantObservers_.end()) {
        return it->second;
    }

    auto observer = RemoteParticipantWrap::CreateObserver(participant);
    participantObservers_[sid] = observer;
    return observer;
}

void RoomObserverWrap::ForgetParticipantObserver(const std::string& sid) {
    std::lock_guard<std::mutex> lock(participantObserversMutex_);
    participantObservers_.erase(sid);
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
    // Get the observer here, on the signaling thread, rather than inside the
    // dispatched lambda. rtc-cpp subscribes to the participant's tracks about a
    // millisecond after this callback, well inside the hop to the JS thread.
    // Events raised in that window are buffered and replayed once bind() runs.
    auto observer = GetOrCreateParticipantObserver(participant);
    dispatchEvent("participantConnected", [participant, observer](Napi::Env env) -> Napi::Value {
        return RemoteParticipantWrap::NewInstance(env, participant, observer);
    });
}

void RoomObserverWrap::onParticipantDisconnected(twilio::video::Room* room, std::shared_ptr<twilio::video::RemoteParticipant> participant) {
    // Reuse whichever observer is on record for this participant, from
    // onParticipantConnected or from a prior room.participants /
    // room.dominantSpeaker read. rtc-cpp raises the remaining
    // trackUnsubscribed callbacks around this same disconnect, and creating a
    // second observer here would replace the one the live JS wrap is bound to,
    // routing those callbacks to an observer nothing is listening through.
    auto observer = GetOrCreateParticipantObserver(participant);
    ForgetParticipantObserver(participant->getSid());

    // This event must reach JS after every trackUnsubscribed already raised for
    // this teardown. The participant's queue and the Room's queue are two
    // independent AsyncContext instances with no ordering guarantee between
    // them, so deliver this through the participant's own queue instead, via
    // its observer, to guarantee the order rather than race for it.
    auto self = shared_from_this();
    RemoteParticipantWrap::DispatchAfterPendingEvents(observer, [self, participant, observer](Napi::Env env) {
        if (self->closed_.load(std::memory_order_acquire) || !self->roomWrap_) return;
        Napi::Value participantObj = RemoteParticipantWrap::NewInstance(env, participant, observer);
        self->roomWrap_->emitEvent("participantDisconnected", participantObj);
    });
}

void RoomObserverWrap::onParticipantReconnecting(const twilio::video::Room* room, std::shared_ptr<twilio::video::RemoteParticipant> participant) {
    auto observer = GetOrCreateParticipantObserver(participant);
    dispatchEvent("participantReconnecting", [participant, observer](Napi::Env env) -> Napi::Value {
        return RemoteParticipantWrap::NewInstance(env, participant, observer);
    });
}

void RoomObserverWrap::onParticipantReconnected(const twilio::video::Room* room, std::shared_ptr<twilio::video::RemoteParticipant> participant) {
    auto observer = GetOrCreateParticipantObserver(participant);
    dispatchEvent("participantReconnected", [participant, observer](Napi::Env env) -> Napi::Value {
        return RemoteParticipantWrap::NewInstance(env, participant, observer);
    });
}

void RoomObserverWrap::onRecordingStarted(twilio::video::Room* room) {
    dispatchEvent("recordingStarted");
}

void RoomObserverWrap::onRecordingStopped(twilio::video::Room* room) {
    dispatchEvent("recordingStopped");
}

void RoomObserverWrap::onDominantSpeakerChanged(const twilio::video::Room* room, std::shared_ptr<twilio::video::RemoteParticipant> participant) {
    auto observer = participant ? GetOrCreateParticipantObserver(participant) : nullptr;
    dispatchEvent("dominantSpeakerChanged", [participant, observer](Napi::Env env) -> Napi::Value {
        if (participant) {
            return RemoteParticipantWrap::NewInstance(env, participant, observer);
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
