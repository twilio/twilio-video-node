#include "local_participant_wrap.h"
#include "../media/local_video_track_wrap.h"
#include "../media/local_audio_track_wrap.h"
#include "../media/local_data_track_wrap.h"
#include "../common/error.h"
#include <vector>

namespace twilio_video_node {

class LocalParticipantObserverImpl : public twilio::video::LocalParticipantObserver {
    struct PendingEvent {
        std::string name;
        std::function<Napi::Value(Napi::Env)> createArgs;
    };

public:
    LocalParticipantObserverImpl() = default;

    // Adopts the JS wrap and replays whatever arrived before it existed, in
    // order. Runs on the JS thread. A no-op if a wrap is already bound.
    void bind(LocalParticipantWrap* wrap, AsyncContext* ctx) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_.load(std::memory_order_acquire) || wrap_ != nullptr) return;
        wrap_ = wrap;
        ctx_ = ctx;

        // Replay while still holding the lock, so a signaling thread callback
        // arriving mid-replay cannot reach the queue ahead of these older events.
        std::vector<PendingEvent> replay;
        replay.swap(pending_);
        for (auto& event : replay) {
            dispatchLocked(std::move(event));
        }
    }

    void close() {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_.load(std::memory_order_acquire)) return;
        closed_.store(true, std::memory_order_release);
        wrap_ = nullptr;
        ctx_ = nullptr;
        pending_.clear();
    }

    void onAudioTrackPublished(twilio::video::LocalParticipant*,
                               std::shared_ptr<twilio::media::LocalAudioTrackPublication> pub) override {
        dispatchTrackEvent("trackPublished", pub->getTrackSid(), pub->getTrackName(), "audio");
    }

    void onVideoTrackPublished(twilio::video::LocalParticipant*,
                               std::shared_ptr<twilio::media::LocalVideoTrackPublication> pub) override {
        dispatchTrackEvent("trackPublished", pub->getTrackSid(), pub->getTrackName(), "video");
    }

    void onDataTrackPublished(twilio::video::LocalParticipant*,
                              std::shared_ptr<twilio::media::LocalDataTrackPublication> pub) override {
        dispatchTrackEvent("trackPublished", pub->getTrackSid(), pub->getTrackName(), "data");
    }

    void onAudioTrackPublicationFailed(twilio::video::LocalParticipant*,
                                       std::shared_ptr<twilio::media::LocalAudioTrack> track,
                                       const twilio::video::Error error) override {
        dispatchPublicationFailed(track->getName(), error.getCode(), error.getMessage());
    }

    void onVideoTrackPublicationFailed(twilio::video::LocalParticipant*,
                                       std::shared_ptr<twilio::media::LocalVideoTrack> track,
                                       const twilio::video::Error error) override {
        dispatchPublicationFailed(track->getName(), error.getCode(), error.getMessage());
    }

    void onDataTrackPublicationFailed(twilio::video::LocalParticipant*,
                                      std::shared_ptr<twilio::media::LocalDataTrack> track,
                                      const twilio::video::Error error) override {
        dispatchPublicationFailed(track->getName(), error.getCode(), error.getMessage());
    }

    void onNetworkQualityLevelChanged(twilio::video::LocalParticipant*,
                                      twilio::video::NetworkQualityLevel level) override {
        auto lvl = static_cast<int>(level);
        dispatchEvent("networkQualityLevelChanged", [lvl](Napi::Env env) {
            return Napi::Number::New(env, lvl);
        });
    }

private:
    void dispatchEvent(const std::string& eventName, std::function<Napi::Value(Napi::Env)> createArgs = nullptr) {
        if (closed_.load(std::memory_order_acquire)) return;

        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_.load(std::memory_order_acquire)) return;

        // Buffer until bind() supplies the wrap. The createArgs lambdas only touch
        // Napi when invoked, so holding them off the JS thread is safe.
        if (!wrap_ || !ctx_) {
            pending_.push_back({eventName, std::move(createArgs)});
            return;
        }

        dispatchLocked({eventName, std::move(createArgs)});
    }

    // Requires mutex_ held and wrap_/ctx_ set.
    void dispatchLocked(PendingEvent event) {
        ctx_->dispatch([this, event = std::move(event)](Napi::Env env) {
            if (closed_.load(std::memory_order_acquire) || !wrap_) return;
            Napi::Value arg = event.createArgs ? event.createArgs(env) : env.Undefined();
            wrap_->emitEvent(event.name, arg);
        });
    }

    void dispatchTrackEvent(const std::string& eventName, std::string sid, std::string name, std::string kind) {
        dispatchEvent(eventName, [sid = std::move(sid), name = std::move(name), kind = std::move(kind)](Napi::Env env) {
            auto obj = Napi::Object::New(env);
            obj.Set("trackSid", Napi::String::New(env, sid));
            obj.Set("trackName", Napi::String::New(env, name));
            obj.Set("kind", Napi::String::New(env, kind));
            return obj;
        });
    }

    // Carries the failed track's name alongside the error so the JS layer can drop
    // its publication bookkeeping for that track. trackName is extra; the JS error
    // lifter reads code/message and ignores it.
    void dispatchPublicationFailed(std::string trackName, uint32_t code, std::string message) {
        dispatchEvent("trackPublicationFailed",
                      [trackName = std::move(trackName), code, message = std::move(message)](Napi::Env env) {
            auto obj = createTwilioErrorObject(env, code, message);
            obj.Set("trackName", Napi::String::New(env, trackName));
            return obj;
        });
    }

    LocalParticipantWrap* wrap_ = nullptr;
    AsyncContext* ctx_ = nullptr;
    std::vector<PendingEvent> pending_;
    std::atomic<bool> closed_{false};
    std::mutex mutex_;
};

Napi::FunctionReference LocalParticipantWrap::constructor_;

void LocalParticipantWrap::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "LocalParticipant", {
        InstanceAccessor("identity", &LocalParticipantWrap::GetIdentity, nullptr),
        InstanceAccessor("sid", &LocalParticipantWrap::GetSid, nullptr),
        InstanceAccessor("state", &LocalParticipantWrap::GetState, nullptr),
        InstanceAccessor("networkQualityLevel", &LocalParticipantWrap::GetNetworkQualityLevel, nullptr),
        InstanceAccessor("signalingRegion", &LocalParticipantWrap::GetSignalingRegion, nullptr),
        InstanceAccessor("videoTracks", &LocalParticipantWrap::GetVideoTracks, nullptr),
        InstanceAccessor("audioTracks", &LocalParticipantWrap::GetAudioTracks, nullptr),
        InstanceAccessor("dataTracks", &LocalParticipantWrap::GetDataTracks, nullptr),
        InstanceMethod("publishTrack", &LocalParticipantWrap::PublishTrack),
        InstanceMethod("unpublishTrack", &LocalParticipantWrap::UnpublishTrack),
        InstanceMethod("setEncodingParameters", &LocalParticipantWrap::SetEncodingParameters),
        InstanceMethod("setEventCallback", &LocalParticipantWrap::SetEventCallback),
    });

    constructor_ = Napi::Persistent(func);
    constructor_.SuppressDestruct();
    exports.Set("LocalParticipant", func);
}

std::shared_ptr<LocalParticipantObserverImpl> LocalParticipantWrap::CreateObserver(
    std::shared_ptr<twilio::video::LocalParticipant> participant) {
    auto observer = std::make_shared<LocalParticipantObserverImpl>();
    participant->setObserver(observer);
    return observer;
}

void LocalParticipantWrap::CloseObserver(const std::shared_ptr<LocalParticipantObserverImpl>& observer) {
    if (observer) observer->close();
}

Napi::Object LocalParticipantWrap::NewInstance(Napi::Env env, std::shared_ptr<twilio::video::LocalParticipant> participant,
                                              std::shared_ptr<LocalParticipantObserverImpl> observer) {
    Napi::EscapableHandleScope scope(env);

    Napi::Object obj = constructor_.New({});
    LocalParticipantWrap* wrap = Napi::ObjectWrap<LocalParticipantWrap>::Unwrap(obj);
    wrap->participant_ = participant;
    wrap->asyncContext_ = std::make_unique<AsyncContext>(env, 0);
    wrap->observer_ = observer ? std::move(observer) : CreateObserver(participant);
    wrap->observer_->bind(wrap, wrap->asyncContext_.get());

    return scope.Escape(obj).ToObject();
}

LocalParticipantWrap::LocalParticipantWrap(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<LocalParticipantWrap>(info) {
}

LocalParticipantWrap::~LocalParticipantWrap() {
    // Detach observer from track first to stop new callbacks arriving
    if (participant_) {
        participant_->setObserver(std::weak_ptr<twilio::video::LocalParticipantObserver>());
    }
    if (observer_) {
        observer_->close();
    }
    eventCallback_.Reset();
    if (asyncContext_) {
        asyncContext_->close();
    }
}

void LocalParticipantWrap::emitEvent(const std::string& eventName, Napi::Value arg) {
    if (eventCallback_.IsEmpty()) return;
    Napi::Env env = eventCallback_.Value().Env();
    if (arg.IsEmpty() || arg.IsUndefined()) {
        eventCallback_.Call({Napi::String::New(env, eventName)});
    } else {
        eventCallback_.Call({Napi::String::New(env, eventName), arg});
    }
}

Napi::Value LocalParticipantWrap::GetIdentity(const Napi::CallbackInfo& info) {
    if (!participant_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), participant_->getIdentity());
}

Napi::Value LocalParticipantWrap::GetSid(const Napi::CallbackInfo& info) {
    if (!participant_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), participant_->getSid());
}

Napi::Value LocalParticipantWrap::GetState(const Napi::CallbackInfo& info) {
    if (!participant_) return Napi::String::New(info.Env(), "disconnected");

    switch (participant_->getState()) {
        case twilio::video::Participant::State::kConnected:
            return Napi::String::New(info.Env(), "connected");
        case twilio::video::Participant::State::kReconnecting:
            return Napi::String::New(info.Env(), "reconnecting");
        case twilio::video::Participant::State::kDisconnected:
        default:
            return Napi::String::New(info.Env(), "disconnected");
    }
}

Napi::Value LocalParticipantWrap::GetNetworkQualityLevel(const Napi::CallbackInfo& info) {
    if (!participant_) return info.Env().Null();

    auto level = participant_->getNetworkQualityLevel();
    if (level == twilio::video::kNetworkQualityLevelUnknown) {
        return info.Env().Null();
    }
    return Napi::Number::New(info.Env(), static_cast<int>(level));
}

Napi::Value LocalParticipantWrap::GetSignalingRegion(const Napi::CallbackInfo& info) {
    if (!participant_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), participant_->getSignalingRegion());
}

Napi::Value LocalParticipantWrap::GetVideoTracks(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!participant_) return Napi::Array::New(env, 0);

    auto publications = participant_->getLocalVideoTracks();
    auto array = Napi::Array::New(env, publications.size());

    uint32_t i = 0;
    for (const auto& pub : publications) {
        auto obj = Napi::Object::New(env);
        obj.Set("trackSid", Napi::String::New(env, pub->getTrackSid()));
        obj.Set("trackName", Napi::String::New(env, pub->getTrackName()));
        obj.Set("kind", Napi::String::New(env, "video"));
        obj.Set("isTrackEnabled", Napi::Boolean::New(env, pub->isTrackEnabled()));
        array.Set(i++, obj);
    }

    return array;
}

Napi::Value LocalParticipantWrap::GetAudioTracks(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!participant_) return Napi::Array::New(env, 0);

    auto publications = participant_->getLocalAudioTracks();
    auto array = Napi::Array::New(env, publications.size());

    uint32_t i = 0;
    for (const auto& pub : publications) {
        auto obj = Napi::Object::New(env);
        obj.Set("trackSid", Napi::String::New(env, pub->getTrackSid()));
        obj.Set("trackName", Napi::String::New(env, pub->getTrackName()));
        obj.Set("kind", Napi::String::New(env, "audio"));
        obj.Set("isTrackEnabled", Napi::Boolean::New(env, pub->isTrackEnabled()));
        array.Set(i++, obj);
    }

    return array;
}

Napi::Value LocalParticipantWrap::GetDataTracks(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!participant_) return Napi::Array::New(env, 0);

    auto publications = participant_->getLocalDataTracks();
    auto array = Napi::Array::New(env, publications.size());

    uint32_t i = 0;
    for (const auto& pub : publications) {
        auto obj = Napi::Object::New(env);
        obj.Set("trackSid", Napi::String::New(env, pub->getTrackSid()));
        obj.Set("trackName", Napi::String::New(env, pub->getTrackName()));
        obj.Set("kind", Napi::String::New(env, "data"));
        obj.Set("isTrackEnabled", Napi::Boolean::New(env, pub->isTrackEnabled()));
        array.Set(i++, obj);
    }

    return array;
}

Napi::Value LocalParticipantWrap::PublishTrack(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!participant_ || info.Length() < 1 || !info[0].IsObject()) {
        return Napi::Boolean::New(env, false);
    }

    auto trackObj = info[0].As<Napi::Object>();

    if (LocalVideoTrackWrap::IsInstance(trackObj)) {
        auto* videoTrack = Napi::ObjectWrap<LocalVideoTrackWrap>::Unwrap(trackObj);
        bool result = participant_->publishTrack(videoTrack->getTrack());
        return Napi::Boolean::New(env, result);
    }

    if (LocalAudioTrackWrap::IsInstance(trackObj)) {
        auto* audioTrack = Napi::ObjectWrap<LocalAudioTrackWrap>::Unwrap(trackObj);
        bool result = participant_->publishTrack(audioTrack->getTrack());
        return Napi::Boolean::New(env, result);
    }

    if (LocalDataTrackWrap::IsInstance(trackObj)) {
        auto* dataTrack = Napi::ObjectWrap<LocalDataTrackWrap>::Unwrap(trackObj);
        bool result = participant_->publishTrack(dataTrack->getTrack());
        return Napi::Boolean::New(env, result);
    }

    return Napi::Boolean::New(env, false);
}

Napi::Value LocalParticipantWrap::UnpublishTrack(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!participant_ || info.Length() < 1 || !info[0].IsObject()) {
        return Napi::Boolean::New(env, false);
    }

    auto trackObj = info[0].As<Napi::Object>();

    if (LocalVideoTrackWrap::IsInstance(trackObj)) {
        auto* videoTrack = Napi::ObjectWrap<LocalVideoTrackWrap>::Unwrap(trackObj);
        bool result = participant_->unpublishTrack(videoTrack->getTrack());
        return Napi::Boolean::New(env, result);
    }

    if (LocalAudioTrackWrap::IsInstance(trackObj)) {
        auto* audioTrack = Napi::ObjectWrap<LocalAudioTrackWrap>::Unwrap(trackObj);
        bool result = participant_->unpublishTrack(audioTrack->getTrack());
        return Napi::Boolean::New(env, result);
    }

    if (LocalDataTrackWrap::IsInstance(trackObj)) {
        auto* dataTrack = Napi::ObjectWrap<LocalDataTrackWrap>::Unwrap(trackObj);
        bool result = participant_->unpublishTrack(dataTrack->getTrack());
        return Napi::Boolean::New(env, result);
    }

    return Napi::Boolean::New(env, false);
}

Napi::Value LocalParticipantWrap::SetEncodingParameters(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!participant_) return env.Undefined();

    twilio::media::EncodingParameters params;

    if (info.Length() >= 1 && info[0].IsObject()) {
        auto obj = info[0].As<Napi::Object>();
        if (obj.Has("maxAudioBitrate")) {
            params.max_audio_bitrate_ = obj.Get("maxAudioBitrate").As<Napi::Number>().Uint32Value();
        }
        if (obj.Has("maxVideoBitrate")) {
            params.max_video_bitrate_ = obj.Get("maxVideoBitrate").As<Napi::Number>().Uint32Value();
        }
    }

    participant_->setEncodingParameters(params);
    return env.Undefined();
}

Napi::Value LocalParticipantWrap::SetEventCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Expected callback function").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    eventCallback_ = Napi::Persistent(info[0].As<Napi::Function>());
    return env.Undefined();
}

}
