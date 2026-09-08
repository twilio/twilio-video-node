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
    // Close each observer rather than only dropping the reference. An observer
    // that never got a JS wrap still holds the events it buffered while
    // waiting for one, and nothing else would ever release them.
    std::unordered_map<std::string, ParticipantObserverRegistration> observers;
    {
        std::lock_guard<std::mutex> lock(participantObserversMutex_);
        observers.swap(participantObservers_);
    }
    for (auto& entry : observers) {
        RemoteParticipantWrap::CloseObserver(entry.second.observer);
    }
    // Closed but not destroyed: close() can run from a listener on this very
    // queue, for instance one that calls room.dispose(), and drain() is still
    // on the stack below it.
    if (asyncContext_) {
        asyncContext_->close();
    }
}

std::shared_ptr<RemoteParticipantObserverImpl> RoomObserverWrap::GetOrCreateParticipantObserver(
    std::shared_ptr<twilio::video::RemoteParticipant> participant) {
    std::string sid = participant->getSid();

    std::lock_guard<std::mutex> lock(participantObserversMutex_);
    auto it = participantObservers_.find(sid);
    if (it != participantObservers_.end()) {
        if (it->second.participant.lock() == participant &&
            !RemoteParticipantWrap::IsObserverClosed(it->second.observer)) {
            return it->second.observer;
        }
        participantObservers_.erase(it);
    }

    auto observer = RemoteParticipantWrap::CreateObserver(participant);
    participantObservers_[sid] = {participant, observer};
    return observer;
}

void RoomObserverWrap::ForgetParticipantObserver(const std::string& sid) {
    std::lock_guard<std::mutex> lock(participantObserversMutex_);
    participantObservers_.erase(sid);
}

void RoomObserverWrap::dispatchRaw(std::function<void(Napi::Env)> fn) {
    if (closed_.load(std::memory_order_acquire)) return;

    std::lock_guard<std::mutex> lock(mutex_);
    if (closed_.load(std::memory_order_acquire) || !asyncContext_ || !roomWrap_) {
        return;
    }

    asyncContext_->dispatch([this, fn](Napi::Env env) {
        if (closed_.load(std::memory_order_acquire) || !roomWrap_) return;
        fn(env);
    });
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

    // This event has two orderings to satisfy, and each queue only provides
    // one. It must arrive after every trackUnsubscribed already raised for
    // this teardown, which are on the participant's queue, and it must stay in
    // order with the Room's own events, such as the dominantSpeakerChanged
    // rtc-cpp raises just before it and the disconnected that may follow. The
    // two queues are independent AsyncContext instances with no ordering
    // between them, so wait on the participant's queue first and use that only
    // to put the event on the Room's queue, where it is emitted in Room order.
    //
    // This orders it against Room events raised before it, not against one
    // raised while it is still waiting: a Room ending at the same moment can
    // reach JS first, and a dispose() from that handler clears this queue
    // before the event lands on it. Ordering the two strictly would need the
    // Room's queue to hold a slot for an event another queue has not produced
    // yet.
    //
    // The observer is captured weakly: this callback is delivered through the
    // observer's own queue, so it is alive by the time it runs, and holding it
    // strongly here would make an observer that never binds to a wrap hold
    // itself alive through the event it has buffered.
    auto self = shared_from_this();
    std::weak_ptr<RemoteParticipantObserverImpl> weakObserver = observer;
    RemoteParticipantWrap::DispatchAfterPendingEvents(observer, [self, participant, weakObserver](Napi::Env) {
        auto observer = weakObserver.lock();
        // Raw `this` past this point, like every other Room event: close()
        // empties the Room's queue, and it always runs before destruction.
        self->dispatchRaw([this_ = self.get(), participant, observer](Napi::Env env) {
            Napi::Value participantObj = RemoteParticipantWrap::NewInstance(env, participant, observer);
            this_->roomWrap_->emitEvent("participantDisconnected", participantObj);
            // Drop the cached wrap now rather than leaving it for a future
            // room.participants read to notice. An application that never reads
            // that getter would otherwise keep every departed participant pinned
            // in memory for the rest of the Room's life.
            this_->roomWrap_->ForgetParticipantWrap(participant->getSid());
        });
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
