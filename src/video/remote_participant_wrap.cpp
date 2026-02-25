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
        closed_.store(true, std::memory_order_release);
        wrap_ = nullptr;
        ctx_ = nullptr;
    }

    void onAudioTrackPublished(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteAudioTrackPublication>) override {}
    void onAudioTrackUnpublished(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteAudioTrackPublication>) override {}
    void onAudioTrackEnabled(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteAudioTrackPublication>) override {}
    void onAudioTrackDisabled(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteAudioTrackPublication>) override {}

    void onAudioTrackSubscribed(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteAudioTrackPublication>,
                                std::shared_ptr<twilio::media::RemoteAudioTrack> track) override {
        if (closed_.load(std::memory_order_acquire) || !ctx_ || !wrap_) return;
        ctx_->dispatch([this, track](Napi::Env env) {
            if (closed_.load(std::memory_order_acquire) || !wrap_) return;
            wrap_->emitEvent("trackSubscribed", RemoteAudioTrackWrap::NewInstance(env, track));
        });
    }

    void onAudioTrackSubscriptionFailed(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteAudioTrackPublication>,
                                        const twilio::video::Error error) override {
        if (closed_.load(std::memory_order_acquire) || !ctx_ || !wrap_) return;
        ctx_->dispatch([this, error](Napi::Env env) {
            if (closed_.load(std::memory_order_acquire) || !wrap_) return;
            wrap_->emitEvent("trackSubscriptionFailed", createTwilioErrorObject(env, error.getCode(), error.getMessage()));
        });
    }

    void onAudioTrackUnsubscribed(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteAudioTrackPublication>,
                                  std::shared_ptr<twilio::media::RemoteAudioTrack> track) override {
        if (closed_.load(std::memory_order_acquire) || !ctx_ || !wrap_) return;
        ctx_->dispatch([this, track](Napi::Env env) {
            if (closed_.load(std::memory_order_acquire) || !wrap_) return;
            wrap_->emitEvent("trackUnsubscribed", RemoteAudioTrackWrap::NewInstance(env, track));
        });
    }

    void onAudioTrackPublishPriorityChanged(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteAudioTrackPublication>,
                                            twilio::media::TrackPriority) override {}

    void onVideoTrackPublished(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteVideoTrackPublication>) override {}
    void onVideoTrackUnpublished(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteVideoTrackPublication>) override {}
    void onVideoTrackEnabled(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteVideoTrackPublication>) override {}
    void onVideoTrackDisabled(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteVideoTrackPublication>) override {}

    void onVideoTrackSubscribed(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteVideoTrackPublication>,
                                std::shared_ptr<twilio::media::RemoteVideoTrack> track) override {
        if (closed_.load(std::memory_order_acquire) || !ctx_ || !wrap_) return;
        ctx_->dispatch([this, track](Napi::Env env) {
            if (closed_.load(std::memory_order_acquire) || !wrap_) return;
            wrap_->emitEvent("trackSubscribed", RemoteVideoTrackWrap::NewInstance(env, track));
        });
    }

    void onVideoTrackSubscriptionFailed(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteVideoTrackPublication>,
                                        const twilio::video::Error error) override {
        if (closed_.load(std::memory_order_acquire) || !ctx_ || !wrap_) return;
        ctx_->dispatch([this, error](Napi::Env env) {
            if (closed_.load(std::memory_order_acquire) || !wrap_) return;
            wrap_->emitEvent("trackSubscriptionFailed", createTwilioErrorObject(env, error.getCode(), error.getMessage()));
        });
    }

    void onVideoTrackUnsubscribed(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteVideoTrackPublication>,
                                  std::shared_ptr<twilio::media::RemoteVideoTrack> track) override {
        if (closed_.load(std::memory_order_acquire) || !ctx_ || !wrap_) return;
        ctx_->dispatch([this, track](Napi::Env env) {
            if (closed_.load(std::memory_order_acquire) || !wrap_) return;
            wrap_->emitEvent("trackUnsubscribed", RemoteVideoTrackWrap::NewInstance(env, track));
        });
    }

    void onVideoTrackPublishPriorityChanged(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteVideoTrackPublication>,
                                            twilio::media::TrackPriority) override {}

    void onDataTrackPublished(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteDataTrackPublication>) override {}
    void onDataTrackUnpublished(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteDataTrackPublication>) override {}

    void onDataTrackSubscribed(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteDataTrackPublication>,
                               std::shared_ptr<twilio::media::RemoteDataTrack> track) override {
        if (closed_.load(std::memory_order_acquire) || !ctx_ || !wrap_) return;
        ctx_->dispatch([this, track](Napi::Env env) {
            if (closed_.load(std::memory_order_acquire) || !wrap_) return;
            wrap_->emitEvent("trackSubscribed", RemoteDataTrackWrap::NewInstance(env, track));
        });
    }

    void onDataTrackSubscriptionFailed(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteDataTrackPublication>,
                                       const twilio::video::Error error) override {
        if (closed_.load(std::memory_order_acquire) || !ctx_ || !wrap_) return;
        ctx_->dispatch([this, error](Napi::Env env) {
            if (closed_.load(std::memory_order_acquire) || !wrap_) return;
            wrap_->emitEvent("trackSubscriptionFailed", createTwilioErrorObject(env, error.getCode(), error.getMessage()));
        });
    }

    void onDataTrackUnsubscribed(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteDataTrackPublication>,
                                 std::shared_ptr<twilio::media::RemoteDataTrack> track) override {
        if (closed_.load(std::memory_order_acquire) || !ctx_ || !wrap_) return;
        ctx_->dispatch([this, track](Napi::Env env) {
            if (closed_.load(std::memory_order_acquire) || !wrap_) return;
            wrap_->emitEvent("trackUnsubscribed", RemoteDataTrackWrap::NewInstance(env, track));
        });
    }

    void onDataTrackPublishPriorityChanged(twilio::video::RemoteParticipant*, std::shared_ptr<twilio::media::RemoteDataTrackPublication>,
                                           twilio::media::TrackPriority) override {}

private:
    RemoteParticipantWrap* wrap_;
    AsyncContext* ctx_;
    std::atomic<bool> closed_{false};
};

Napi::FunctionReference RemoteParticipantWrap::constructor_;

void RemoteParticipantWrap::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "RemoteParticipant", {
        InstanceAccessor("identity", &RemoteParticipantWrap::GetIdentity, nullptr),
        InstanceAccessor("sid", &RemoteParticipantWrap::GetSid, nullptr),
        InstanceAccessor("videoTracks", &RemoteParticipantWrap::GetVideoTracks, nullptr),
        InstanceAccessor("audioTracks", &RemoteParticipantWrap::GetAudioTracks, nullptr),
        InstanceAccessor("dataTracks", &RemoteParticipantWrap::GetDataTracks, nullptr),
        InstanceMethod("on", &RemoteParticipantWrap::On),
        InstanceMethod("off", &RemoteParticipantWrap::Off),
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
    if (observer_) {
        observer_->close();
    }
    if (participant_) {
        participant_->setObserver(std::weak_ptr<twilio::video::RemoteParticipantObserver>());
    }
    if (asyncContext_) {
        asyncContext_->close();
    }
}

void RemoteParticipantWrap::emitEvent(const std::string& eventName, Napi::Value arg) {
    auto it = eventListeners_.find(eventName);
    if (it == eventListeners_.end()) return;

    for (auto& listener : it->second) {
        if (!listener.IsEmpty()) {
            if (arg.IsEmpty() || arg.IsUndefined()) {
                listener.Call({});
            } else {
                listener.Call({arg});
            }
        }
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

Napi::Value RemoteParticipantWrap::On(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsFunction()) {
        Napi::TypeError::New(env, "Expected event name and callback").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string eventName = info[0].As<Napi::String>().Utf8Value();
    auto callback = info[1].As<Napi::Function>();

    eventListeners_[eventName].push_back(Napi::Persistent(callback));

    return info.This();
}

Napi::Value RemoteParticipantWrap::Off(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected event name").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string eventName = info[0].As<Napi::String>().Utf8Value();
    eventListeners_.erase(eventName);

    return info.This();
}

}
