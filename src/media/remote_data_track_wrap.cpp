#include "remote_data_track_wrap.h"
#include <twilio/media/data_track_observer.h>

namespace twilio_video_node {

class RemoteDataTrackObserverImpl : public twilio::media::RemoteDataTrackObserver {
public:
    RemoteDataTrackObserverImpl(RemoteDataTrackWrap* wrap) : wrap_(wrap) {}

    void onMessage(twilio::media::RemoteDataTrack* track, const std::string& message) override {
        if (wrap_) {
            wrap_->onMessage(message);
        }
    }

    void onMessage(twilio::media::RemoteDataTrack* track, const uint8_t* message, size_t size) override {
        if (wrap_) {
            wrap_->onBufferMessage(message, size);
        }
    }

private:
    RemoteDataTrackWrap* wrap_;
};

Napi::FunctionReference RemoteDataTrackWrap::constructor_;

void RemoteDataTrackWrap::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "RemoteDataTrack", {
        InstanceAccessor("name", &RemoteDataTrackWrap::GetName, nullptr),
        InstanceAccessor("sid", &RemoteDataTrackWrap::GetSid, nullptr),
        InstanceAccessor("reliable", &RemoteDataTrackWrap::IsReliable, nullptr),
        InstanceAccessor("ordered", &RemoteDataTrackWrap::IsOrdered, nullptr),
        InstanceMethod("onMessage", &RemoteDataTrackWrap::OnMessage),
        InstanceMethod("removeMessageCallback", &RemoteDataTrackWrap::RemoveMessageCallback),
    });

    constructor_ = Napi::Persistent(func);
    constructor_.SuppressDestruct();
    exports.Set("RemoteDataTrack", func);
}

Napi::Object RemoteDataTrackWrap::NewInstance(Napi::Env env, std::shared_ptr<twilio::media::RemoteDataTrack> track) {
    Napi::EscapableHandleScope scope(env);

    Napi::Object obj = constructor_.New({});
    RemoteDataTrackWrap* wrap = Napi::ObjectWrap<RemoteDataTrackWrap>::Unwrap(obj);
    wrap->track_ = track;
    wrap->asyncContext_ = std::make_unique<AsyncContext>(env);

    wrap->observer_ = std::make_shared<RemoteDataTrackObserverImpl>(wrap);
    track->setObserver(wrap->observer_);

    return scope.Escape(obj).ToObject();
}

RemoteDataTrackWrap::RemoteDataTrackWrap(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<RemoteDataTrackWrap>(info) {
}

RemoteDataTrackWrap::~RemoteDataTrackWrap() {
    if (track_) {
        track_->setObserver(std::weak_ptr<twilio::media::RemoteDataTrackObserver>());
    }
    if (asyncContext_) {
        asyncContext_->close();
    }
}

void RemoteDataTrackWrap::onMessage(const std::string& message) {
    if (!asyncContext_ || messageCallback_.IsEmpty()) return;

    asyncContext_->dispatch([this, message](Napi::Env env) {
        if (messageCallback_.IsEmpty()) return;

        Napi::HandleScope scope(env);
        messageCallback_.Call({Napi::String::New(env, message)});
    });
}

void RemoteDataTrackWrap::onBufferMessage(const uint8_t* data, size_t length) {
    if (!asyncContext_ || messageCallback_.IsEmpty()) return;

    std::vector<uint8_t> dataCopy(data, data + length);

    asyncContext_->dispatch([this, dataCopy = std::move(dataCopy)](Napi::Env env) {
        if (messageCallback_.IsEmpty()) return;

        Napi::HandleScope scope(env);
        auto buffer = Napi::Buffer<uint8_t>::Copy(env, dataCopy.data(), dataCopy.size());
        messageCallback_.Call({buffer});
    });
}

Napi::Value RemoteDataTrackWrap::GetName(const Napi::CallbackInfo& info) {
    if (!track_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), track_->getName());
}

Napi::Value RemoteDataTrackWrap::GetSid(const Napi::CallbackInfo& info) {
    if (!track_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), track_->getSid());
}

Napi::Value RemoteDataTrackWrap::IsReliable(const Napi::CallbackInfo& info) {
    if (!track_) return Napi::Boolean::New(info.Env(), false);
    return Napi::Boolean::New(info.Env(), track_->isReliable());
}

Napi::Value RemoteDataTrackWrap::IsOrdered(const Napi::CallbackInfo& info) {
    if (!track_) return Napi::Boolean::New(info.Env(), false);
    return Napi::Boolean::New(info.Env(), track_->isOrdered());
}

Napi::Value RemoteDataTrackWrap::OnMessage(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Expected callback function").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    messageCallback_.Reset();
    messageCallback_ = Napi::Persistent(info[0].As<Napi::Function>());

    return env.Undefined();
}

Napi::Value RemoteDataTrackWrap::RemoveMessageCallback(const Napi::CallbackInfo& info) {
    messageCallback_.Reset();
    return info.Env().Undefined();
}

}
