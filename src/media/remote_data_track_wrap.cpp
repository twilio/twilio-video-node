#include "remote_data_track_wrap.h"
#include <twilio/media/data_track_observer.h>

namespace twilio_video_node {

class RemoteDataTrackObserverImpl : public twilio::media::RemoteDataTrackObserver {
public:
    RemoteDataTrackObserverImpl(RemoteDataTrackWrap* wrap, AsyncContext* ctx)
        : wrap_(wrap), ctx_(ctx) {}

    void close() {
        closed_.store(true, std::memory_order_release);
        wrap_ = nullptr;
        ctx_ = nullptr;
    }

    void onMessage(twilio::media::RemoteDataTrack* track, const std::string& message) override {
        if (closed_.load(std::memory_order_acquire) || !ctx_ || !wrap_) return;
        ctx_->dispatch([this, message](Napi::Env env) {
            if (closed_.load(std::memory_order_acquire) || !wrap_) return;
            wrap_->onMessage(message);
        });
    }

    void onMessage(twilio::media::RemoteDataTrack* track, const uint8_t* message, size_t size) override {
        if (closed_.load(std::memory_order_acquire) || !ctx_ || !wrap_) return;
        // Copy data before dispatching since the pointer won't survive the callback
        std::vector<uint8_t> dataCopy(message, message + size);
        ctx_->dispatch([this, dataCopy = std::move(dataCopy)](Napi::Env env) {
            if (closed_.load(std::memory_order_acquire) || !wrap_) return;
            wrap_->onBufferMessage(dataCopy.data(), dataCopy.size());
        });
    }

private:
    RemoteDataTrackWrap* wrap_;
    AsyncContext* ctx_;
    std::atomic<bool> closed_{false};
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
    wrap->asyncContext_ = std::make_unique<AsyncContext>(env, 0);
    wrap->observer_ = std::make_shared<RemoteDataTrackObserverImpl>(wrap, wrap->asyncContext_.get());
    track->setObserver(wrap->observer_);

    return scope.Escape(obj).ToObject();
}

RemoteDataTrackWrap::RemoteDataTrackWrap(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<RemoteDataTrackWrap>(info) {
}

RemoteDataTrackWrap::~RemoteDataTrackWrap() {
    if (observer_) {
        observer_->close();
    }
    if (track_) {
        track_->setObserver(std::weak_ptr<twilio::media::RemoteDataTrackObserver>());
    }
    if (asyncContext_) {
        asyncContext_->close();
    }
}

void RemoteDataTrackWrap::onMessage(const std::string& message) {
    if (messageCallback_.IsEmpty()) return;
    Napi::HandleScope scope(messageCallback_.Env());
    messageCallback_.Call({Napi::String::New(messageCallback_.Env(), message)});
}

void RemoteDataTrackWrap::onBufferMessage(const uint8_t* data, size_t length) {
    if (messageCallback_.IsEmpty()) return;
    Napi::Env env = messageCallback_.Env();
    Napi::HandleScope scope(env);
    auto buffer = Napi::Buffer<uint8_t>::Copy(env, data, length);
    messageCallback_.Call({buffer});
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
