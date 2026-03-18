#include "remote_participant_wrap.h"
#include "../media/remote_video_track_wrap.h"
#include "../media/remote_audio_track_wrap.h"
#include "../media/remote_data_track_wrap.h"
#include "../common/error.h"

namespace twilio_video_node {

class RemoteParticipantObserverImpl : public twilio::video::RemoteParticipantObserver {
public:
    RemoteParticipantObserverImpl(RemoteParticipantWrap* wrap, AsyncContext* ctx)
        : wrap_(wrap), ctx_(ctx) {}

    void close() {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_.load(std::memory_order_acquire)) return;
        closed_.store(true, std::memory_order_release);
        wrap_ = nullptr;
    }

    // Audio track events
    void onAudioTrackPublished(twilio::video::RemoteParticipant*,
                               std::shared_ptr<twilio::media::RemoteAudioTrackPublication> pub) override {
        dispatchTrackEvent("trackPublished", pub->getTrackSid(), pub->getTrackName());
    }
    void onAudioTrackUnpublished(twilio::video::RemoteParticipant*,
                                 std::shared_ptr<twilio::media::RemoteAudioTrackPublication> pub) override {
        dispatchTrackEvent("trackUnpublished", pub->getTrackSid(), pub->getTrackName());
    }
    void onAudioTrackEnabled(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteAudioTrackPublication> pub) override {
        dispatchPubStateEvent("trackEnabled", pub->getTrackSid(), pub->getTrackName(), pub->isTrackSubscribed());
    }
    void onAudioTrackDisabled(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteAudioTrackPublication> pub) override {
        dispatchPubStateEvent("trackDisabled", pub->getTrackSid(), pub->getTrackName(), pub->isTrackSubscribed());
    }
    void onAudioTrackSubscribed(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteAudioTrackPublication>,
                                std::shared_ptr<twilio::media::RemoteAudioTrack> track) override {
        dispatchEvent("trackSubscribed", [track](Napi::Env env) {
            return RemoteAudioTrackWrap::NewInstance(env, track);
        });
    }
    void onAudioTrackSubscriptionFailed(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteAudioTrackPublication>,
                                        const twilio::video::Error error) override {
        dispatchErrorEvent("trackSubscriptionFailed", error.getCode(), error.getMessage());
    }
    void onAudioTrackUnsubscribed(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteAudioTrackPublication>,
                                  std::shared_ptr<twilio::media::RemoteAudioTrack> track) override {
        dispatchEvent("trackUnsubscribed", [track](Napi::Env env) {
            return RemoteAudioTrackWrap::NewInstance(env, track);
        });
    }
    void onAudioTrackPublishPriorityChanged(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteAudioTrackPublication>,
                                            twilio::media::TrackPriority) override {}

    // Video track events
    void onVideoTrackPublished(twilio::video::RemoteParticipant*,
                               std::shared_ptr<twilio::media::RemoteVideoTrackPublication> pub) override {
        dispatchTrackEvent("trackPublished", pub->getTrackSid(), pub->getTrackName());
    }
    void onVideoTrackUnpublished(twilio::video::RemoteParticipant*,
                                 std::shared_ptr<twilio::media::RemoteVideoTrackPublication> pub) override {
        dispatchTrackEvent("trackUnpublished", pub->getTrackSid(), pub->getTrackName());
    }
    void onVideoTrackEnabled(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteVideoTrackPublication> pub) override {
        dispatchPubStateEvent("trackEnabled", pub->getTrackSid(), pub->getTrackName(), pub->isTrackSubscribed());
    }
    void onVideoTrackDisabled(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteVideoTrackPublication> pub) override {
        dispatchPubStateEvent("trackDisabled", pub->getTrackSid(), pub->getTrackName(), pub->isTrackSubscribed());
    }
    void onVideoTrackSubscribed(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteVideoTrackPublication>,
                                std::shared_ptr<twilio::media::RemoteVideoTrack> track) override {
        dispatchEvent("trackSubscribed", [track](Napi::Env env) {
            return RemoteVideoTrackWrap::NewInstance(env, track);
        });
    }
    void onVideoTrackSubscriptionFailed(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteVideoTrackPublication>,
                                        const twilio::video::Error error) override {
        dispatchErrorEvent("trackSubscriptionFailed", error.getCode(), error.getMessage());
    }
    void onVideoTrackUnsubscribed(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteVideoTrackPublication>,
                                  std::shared_ptr<twilio::media::RemoteVideoTrack> track) override {
        dispatchEvent("trackUnsubscribed", [track](Napi::Env env) {
            return RemoteVideoTrackWrap::NewInstance(env, track);
        });
    }
    void onVideoTrackPublishPriorityChanged(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteVideoTrackPublication>,
                                            twilio::media::TrackPriority) override {}
    void onVideoTrackSwitchedOff(twilio::video::RemoteParticipant*,
                                 std::shared_ptr<twilio::media::RemoteVideoTrack> track) override {
        dispatchEvent("videoTrackSwitchedOff", [track](Napi::Env env) {
            return RemoteVideoTrackWrap::NewInstance(env, track);
        });
    }
    void onVideoTrackSwitchedOn(twilio::video::RemoteParticipant*,
                                std::shared_ptr<twilio::media::RemoteVideoTrack> track) override {
        dispatchEvent("videoTrackSwitchedOn", [track](Napi::Env env) {
            return RemoteVideoTrackWrap::NewInstance(env, track);
        });
    }

    // Data track events
    void onDataTrackPublished(twilio::video::RemoteParticipant*,
                              std::shared_ptr<twilio::media::RemoteDataTrackPublication> pub) override {
        dispatchTrackEvent("trackPublished", pub->getTrackSid(), pub->getTrackName());
    }
    void onDataTrackUnpublished(twilio::video::RemoteParticipant*,
                                std::shared_ptr<twilio::media::RemoteDataTrackPublication> pub) override {
        dispatchTrackEvent("trackUnpublished", pub->getTrackSid(), pub->getTrackName());
    }
    void onDataTrackSubscribed(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteDataTrackPublication>,
                               std::shared_ptr<twilio::media::RemoteDataTrack> track) override {
        dispatchEvent("trackSubscribed", [track](Napi::Env env) {
            return RemoteDataTrackWrap::NewInstance(env, track);
        });
    }
    void onDataTrackSubscriptionFailed(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteDataTrackPublication>,
                                       const twilio::video::Error error) override {
        dispatchErrorEvent("trackSubscriptionFailed", error.getCode(), error.getMessage());
    }
    void onDataTrackUnsubscribed(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteDataTrackPublication>,
                                 std::shared_ptr<twilio::media::RemoteDataTrack> track) override {
        dispatchEvent("trackUnsubscribed", [track](Napi::Env env) {
            return RemoteDataTrackWrap::NewInstance(env, track);
        });
    }
    void onDataTrackPublishPriorityChanged(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteDataTrackPublication>,
                                           twilio::media::TrackPriority) override {}

private:
    void dispatchEvent(const std::string& eventName, std::function<Napi::Value(Napi::Env)> createArgs = nullptr) {
        if (closed_.load(std::memory_order_acquire)) return;

        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_.load(std::memory_order_acquire) || !wrap_) return;

        ctx_->dispatch([this, eventName, createArgs](Napi::Env env) {
            if (closed_.load(std::memory_order_acquire) || !wrap_) return;
            Napi::Value arg = createArgs ? createArgs(env) : env.Undefined();
            wrap_->emitEvent(eventName, arg);
        });
    }

    void dispatchTrackEvent(const std::string& eventName, std::string sid, std::string name) {
        dispatchEvent(eventName, [sid = std::move(sid), name = std::move(name)](Napi::Env env) {
            auto obj = Napi::Object::New(env);
            obj.Set("trackSid", Napi::String::New(env, sid));
            obj.Set("trackName", Napi::String::New(env, name));
            return obj;
        });
    }

    void dispatchPubStateEvent(const std::string& eventName, std::string sid, std::string name, bool subscribed) {
        dispatchEvent(eventName, [sid = std::move(sid), name = std::move(name), subscribed](Napi::Env env) {
            auto obj = Napi::Object::New(env);
            obj.Set("trackSid", Napi::String::New(env, sid));
            obj.Set("trackName", Napi::String::New(env, name));
            obj.Set("isSubscribed", Napi::Boolean::New(env, subscribed));
            return obj;
        });
    }

    void dispatchErrorEvent(const std::string& eventName, uint32_t code, std::string message) {
        dispatchEvent(eventName, [code, message = std::move(message)](Napi::Env env) {
            return createTwilioErrorObject(env, code, message);
        });
    }

    RemoteParticipantWrap* wrap_;
    AsyncContext* ctx_;
    std::atomic<bool> closed_{false};
    std::mutex mutex_;
};

Napi::FunctionReference RemoteParticipantWrap::constructor_;

void RemoteParticipantWrap::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "RemoteParticipant", {
        InstanceAccessor("identity", &RemoteParticipantWrap::GetIdentity, nullptr),
        InstanceAccessor("sid", &RemoteParticipantWrap::GetSid, nullptr),
        InstanceAccessor("videoTracks", &RemoteParticipantWrap::GetVideoTracks, nullptr),
        InstanceAccessor("audioTracks", &RemoteParticipantWrap::GetAudioTracks, nullptr),
        InstanceAccessor("dataTracks", &RemoteParticipantWrap::GetDataTracks, nullptr),
        InstanceMethod("setEventCallback", &RemoteParticipantWrap::SetEventCallback),
    });

    constructor_ = Napi::Persistent(func);
    constructor_.SuppressDestruct();
    exports.Set("RemoteParticipant", func);
}

Napi::Object RemoteParticipantWrap::NewInstance(Napi::Env env, std::shared_ptr<twilio::video::RemoteParticipant> participant) {
    Napi::EscapableHandleScope scope(env);

    Napi::Object obj = constructor_.New({});
    RemoteParticipantWrap* wrap = Napi::ObjectWrap<RemoteParticipantWrap>::Unwrap(obj);
    wrap->participant_ = participant;
    wrap->asyncContext_ = std::make_unique<AsyncContext>(env, 0);
    wrap->observer_ = std::make_shared<RemoteParticipantObserverImpl>(wrap, wrap->asyncContext_.get());
    participant->setObserver(wrap->observer_);

    return scope.Escape(obj).ToObject();
}

RemoteParticipantWrap::RemoteParticipantWrap(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<RemoteParticipantWrap>(info) {
}

RemoteParticipantWrap::~RemoteParticipantWrap() {
    // Detach observer from track first to stop new callbacks arriving
    if (participant_) {
        participant_->setObserver(std::weak_ptr<twilio::video::RemoteParticipantObserver>());
    }
    if (observer_) {
        observer_->close();
    }
    eventCallback_.Reset();
    if (asyncContext_) {
        asyncContext_->close();
    }
}

void RemoteParticipantWrap::emitEvent(const std::string& eventName, Napi::Value arg) {
    if (eventCallback_.IsEmpty()) return;
    Napi::Env env = eventCallback_.Value().Env();
    if (arg.IsEmpty() || arg.IsUndefined()) {
        eventCallback_.Call({Napi::String::New(env, eventName)});
    } else {
        eventCallback_.Call({Napi::String::New(env, eventName), arg});
    }
}

Napi::Value RemoteParticipantWrap::GetIdentity(const Napi::CallbackInfo& info) {
    if (!participant_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), participant_->getIdentity());
}

Napi::Value RemoteParticipantWrap::GetSid(const Napi::CallbackInfo& info) {
    if (!participant_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), participant_->getSid());
}

Napi::Value RemoteParticipantWrap::GetVideoTracks(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!participant_) return Napi::Array::New(env, 0);

    auto publications = participant_->getRemoteVideoTracks();
    auto array = Napi::Array::New(env, publications.size());

    uint32_t i = 0;
    for (const auto& pub : publications) {
        auto obj = Napi::Object::New(env);
        obj.Set("trackSid", Napi::String::New(env, pub->getTrackSid()));
        obj.Set("trackName", Napi::String::New(env, pub->getTrackName()));
        obj.Set("isSubscribed", Napi::Boolean::New(env, pub->isTrackSubscribed()));
        if (pub->isTrackSubscribed()) {
            obj.Set("track", RemoteVideoTrackWrap::NewInstance(env, pub->getRemoteTrack()));
        }
        array.Set(i++, obj);
    }

    return array;
}

Napi::Value RemoteParticipantWrap::GetAudioTracks(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!participant_) return Napi::Array::New(env, 0);

    auto publications = participant_->getRemoteAudioTracks();
    auto array = Napi::Array::New(env, publications.size());

    uint32_t i = 0;
    for (const auto& pub : publications) {
        auto obj = Napi::Object::New(env);
        obj.Set("trackSid", Napi::String::New(env, pub->getTrackSid()));
        obj.Set("trackName", Napi::String::New(env, pub->getTrackName()));
        obj.Set("isSubscribed", Napi::Boolean::New(env, pub->isTrackSubscribed()));
        if (pub->isTrackSubscribed()) {
            obj.Set("track", RemoteAudioTrackWrap::NewInstance(env, pub->getRemoteTrack()));
        }
        array.Set(i++, obj);
    }

    return array;
}

Napi::Value RemoteParticipantWrap::GetDataTracks(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!participant_) return Napi::Array::New(env, 0);

    auto publications = participant_->getRemoteDataTracks();
    auto array = Napi::Array::New(env, publications.size());

    uint32_t i = 0;
    for (const auto& pub : publications) {
        auto obj = Napi::Object::New(env);
        obj.Set("trackSid", Napi::String::New(env, pub->getTrackSid()));
        obj.Set("trackName", Napi::String::New(env, pub->getTrackName()));
        obj.Set("isSubscribed", Napi::Boolean::New(env, pub->isTrackSubscribed()));
        if (pub->isTrackSubscribed()) {
            obj.Set("track", RemoteDataTrackWrap::NewInstance(env, pub->getRemoteTrack()));
        }
        array.Set(i++, obj);
    }

    return array;
}

Napi::Value RemoteParticipantWrap::SetEventCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Expected callback function").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    eventCallback_ = Napi::Persistent(info[0].As<Napi::Function>());
    return env.Undefined();
}

}
