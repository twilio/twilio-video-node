#include "local_participant_wrap.h"
#include "../media/local_video_track_wrap.h"
#include "../media/local_audio_track_wrap.h"
#include "../media/local_data_track_wrap.h"
#include "../common/error.h"

namespace twilio_video_node {

class LocalParticipantObserverImpl : public twilio::video::LocalParticipantObserver {
public:
    LocalParticipantObserverImpl(LocalParticipantWrap* wrap, AsyncContext* ctx)
        : wrap_(wrap), ctx_(ctx) {}

    void close() {
        closed_.store(true, std::memory_order_release);
        wrap_ = nullptr;
        ctx_ = nullptr;
    }

    void onAudioTrackPublished(twilio::video::LocalParticipant*,
                               std::shared_ptr<twilio::media::LocalAudioTrackPublication> pub) override {
        if (closed_.load(std::memory_order_acquire) || !ctx_ || !wrap_) return;
        auto sid = pub->getTrackSid();
        auto name = pub->getTrackName();
        ctx_->dispatch([this, sid, name](Napi::Env env) {
            if (closed_.load(std::memory_order_acquire) || !wrap_) return;
            auto obj = Napi::Object::New(env);
            obj.Set("trackSid", Napi::String::New(env, sid));
            obj.Set("trackName", Napi::String::New(env, name));
            wrap_->emitEvent("trackPublished", obj);
        });
    }

    void onVideoTrackPublished(twilio::video::LocalParticipant*,
                               std::shared_ptr<twilio::media::LocalVideoTrackPublication> pub) override {
        if (closed_.load(std::memory_order_acquire) || !ctx_ || !wrap_) return;
        auto sid = pub->getTrackSid();
        auto name = pub->getTrackName();
        ctx_->dispatch([this, sid, name](Napi::Env env) {
            if (closed_.load(std::memory_order_acquire) || !wrap_) return;
            auto obj = Napi::Object::New(env);
            obj.Set("trackSid", Napi::String::New(env, sid));
            obj.Set("trackName", Napi::String::New(env, name));
            wrap_->emitEvent("trackPublished", obj);
        });
    }

    void onDataTrackPublished(twilio::video::LocalParticipant*,
                              std::shared_ptr<twilio::media::LocalDataTrackPublication> pub) override {
        if (closed_.load(std::memory_order_acquire) || !ctx_ || !wrap_) return;
        auto sid = pub->getTrackSid();
        auto name = pub->getTrackName();
        ctx_->dispatch([this, sid, name](Napi::Env env) {
            if (closed_.load(std::memory_order_acquire) || !wrap_) return;
            auto obj = Napi::Object::New(env);
            obj.Set("trackSid", Napi::String::New(env, sid));
            obj.Set("trackName", Napi::String::New(env, name));
            wrap_->emitEvent("trackPublished", obj);
        });
    }

    void onAudioTrackPublicationFailed(twilio::video::LocalParticipant*,
                                       std::shared_ptr<twilio::media::LocalAudioTrack>,
                                       const twilio::video::Error error) override {
        if (closed_.load(std::memory_order_acquire) || !ctx_ || !wrap_) return;
        auto code = error.getCode();
        auto message = error.getMessage();
        ctx_->dispatch([this, code, message](Napi::Env env) {
            if (closed_.load(std::memory_order_acquire) || !wrap_) return;
            wrap_->emitEvent("trackPublicationFailed", createTwilioErrorObject(env, code, message));
        });
    }

    void onVideoTrackPublicationFailed(twilio::video::LocalParticipant*,
                                       std::shared_ptr<twilio::media::LocalVideoTrack>,
                                       const twilio::video::Error error) override {
        if (closed_.load(std::memory_order_acquire) || !ctx_ || !wrap_) return;
        auto code = error.getCode();
        auto message = error.getMessage();
        ctx_->dispatch([this, code, message](Napi::Env env) {
            if (closed_.load(std::memory_order_acquire) || !wrap_) return;
            wrap_->emitEvent("trackPublicationFailed", createTwilioErrorObject(env, code, message));
        });
    }

    void onDataTrackPublicationFailed(twilio::video::LocalParticipant*,
                                      std::shared_ptr<twilio::media::LocalDataTrack>,
                                      const twilio::video::Error error) override {
        if (closed_.load(std::memory_order_acquire) || !ctx_ || !wrap_) return;
        auto code = error.getCode();
        auto message = error.getMessage();
        ctx_->dispatch([this, code, message](Napi::Env env) {
            if (closed_.load(std::memory_order_acquire) || !wrap_) return;
            wrap_->emitEvent("trackPublicationFailed", createTwilioErrorObject(env, code, message));
        });
    }

    void onNetworkQualityLevelChanged(twilio::video::LocalParticipant*,
                                      twilio::video::NetworkQualityLevel level) override {
        if (closed_.load(std::memory_order_acquire) || !ctx_ || !wrap_) return;
        auto lvl = static_cast<int>(level);
        ctx_->dispatch([this, lvl](Napi::Env env) {
            if (closed_.load(std::memory_order_acquire) || !wrap_) return;
            wrap_->emitEvent("networkQualityLevelChanged", Napi::Number::New(env, lvl));
        });
    }

private:
    LocalParticipantWrap* wrap_;
    AsyncContext* ctx_;
    std::atomic<bool> closed_{false};
};

Napi::FunctionReference LocalParticipantWrap::constructor_;

void LocalParticipantWrap::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "LocalParticipant", {
        InstanceAccessor("identity", &LocalParticipantWrap::GetIdentity, nullptr),
        InstanceAccessor("sid", &LocalParticipantWrap::GetSid, nullptr),
        InstanceAccessor("signalingRegion", &LocalParticipantWrap::GetSignalingRegion, nullptr),
        InstanceAccessor("videoTracks", &LocalParticipantWrap::GetVideoTracks, nullptr),
        InstanceAccessor("audioTracks", &LocalParticipantWrap::GetAudioTracks, nullptr),
        InstanceAccessor("dataTracks", &LocalParticipantWrap::GetDataTracks, nullptr),
        InstanceMethod("publishTrack", &LocalParticipantWrap::PublishTrack),
        InstanceMethod("unpublishTrack", &LocalParticipantWrap::UnpublishTrack),
        InstanceMethod("setEncodingParameters", &LocalParticipantWrap::SetEncodingParameters),
        InstanceMethod("on", &LocalParticipantWrap::On),
        InstanceMethod("off", &LocalParticipantWrap::Off),
    });

    constructor_ = Napi::Persistent(func);
    constructor_.SuppressDestruct();
    exports.Set("LocalParticipant", func);
}

Napi::Object LocalParticipantWrap::NewInstance(Napi::Env env, std::shared_ptr<twilio::video::LocalParticipant> participant) {
    Napi::EscapableHandleScope scope(env);

    Napi::Object obj = constructor_.New({});
    LocalParticipantWrap* wrap = Napi::ObjectWrap<LocalParticipantWrap>::Unwrap(obj);
    wrap->participant_ = participant;
    wrap->asyncContext_ = std::make_unique<AsyncContext>(env, 0);
    wrap->observer_ = std::make_shared<LocalParticipantObserverImpl>(wrap, wrap->asyncContext_.get());
    participant->setObserver(wrap->observer_);

    return scope.Escape(obj).ToObject();
}

LocalParticipantWrap::LocalParticipantWrap(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<LocalParticipantWrap>(info) {
}

LocalParticipantWrap::~LocalParticipantWrap() {
    if (observer_) {
        observer_->close();
    }
    if (participant_) {
        participant_->setObserver(std::weak_ptr<twilio::video::LocalParticipantObserver>());
    }
    if (asyncContext_) {
        asyncContext_->close();
    }
}

void LocalParticipantWrap::emitEvent(const std::string& eventName, Napi::Value arg) {
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

Napi::Value LocalParticipantWrap::GetIdentity(const Napi::CallbackInfo& info) {
    if (!participant_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), participant_->getIdentity());
}

Napi::Value LocalParticipantWrap::GetSid(const Napi::CallbackInfo& info) {
    if (!participant_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), participant_->getSid());
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

Napi::Value LocalParticipantWrap::On(const Napi::CallbackInfo& info) {
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

Napi::Value LocalParticipantWrap::Off(const Napi::CallbackInfo& info) {
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
