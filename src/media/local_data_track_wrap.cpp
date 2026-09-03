#include "local_data_track_wrap.h"

namespace twilio_video_node {
namespace {

// DataTrackOptions stores -1 when unset, so the requested value is preserved
// exactly, 65535 included.
Napi::Value RequestedOptionOrNull(Napi::Env env, int value) {
    if (value < 0) {
        return env.Null();
    }
    return Napi::Number::New(env, value);
}

}

// --- LocalDataTrackSendObserver ---

void LocalDataTrackSendObserver::detach() {
    std::lock_guard<std::mutex> lock(mutex_);
    owner_ = nullptr;
}

void LocalDataTrackSendObserver::onSendProcessedWithFailure(
    twilio::media::LocalDataTrack*,
    twilio::media::LocalDataTrackMessageId message_id,
    const twilio::video::Error twilio_error) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!owner_ || !owner_->asyncContext_) return;
    const std::string message = twilio_error.getMessage();
    LocalDataTrackWrap* owner = owner_;
    owner_->asyncContext_->dispatch([owner, message_id, message](Napi::Env) {
        owner->settleSend(static_cast<uint64_t>(message_id), false, message);
    });
}

void LocalDataTrackSendObserver::onSendProcessedSuccessfully(
    twilio::media::LocalDataTrack*,
    twilio::media::LocalDataTrackMessageId message_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!owner_ || !owner_->asyncContext_) return;
    LocalDataTrackWrap* owner = owner_;
    owner_->asyncContext_->dispatch([owner, message_id](Napi::Env) {
        owner->settleSend(static_cast<uint64_t>(message_id), true, std::string());
    });
}

// --- LocalDataTrackWrap ---

Napi::FunctionReference LocalDataTrackWrap::constructor_;

bool LocalDataTrackWrap::IsInstance(Napi::Object obj) {
    return obj.InstanceOf(constructor_.Value());
}

void LocalDataTrackWrap::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "LocalDataTrack", {
        InstanceAccessor("name", &LocalDataTrackWrap::GetName, nullptr),
        InstanceAccessor("kind", &LocalDataTrackWrap::GetKind, nullptr),
        InstanceAccessor("maxPacketLifeTime", &LocalDataTrackWrap::GetMaxPacketLifeTime, nullptr),
        InstanceAccessor("maxRetransmits", &LocalDataTrackWrap::GetMaxRetransmits, nullptr),
        InstanceAccessor("reliable", &LocalDataTrackWrap::IsReliable, nullptr),
        InstanceAccessor("ordered", &LocalDataTrackWrap::IsOrdered, nullptr),
        InstanceMethod("send", &LocalDataTrackWrap::Send),
    });

    constructor_ = Napi::Persistent(func);
    constructor_.SuppressDestruct();
    exports.Set("LocalDataTrack", func);
}

Napi::Object LocalDataTrackWrap::NewInstance(Napi::Env env,
                                              std::shared_ptr<twilio::media::MediaFactory> factory,
                                              const twilio::media::DataTrackOptions& options) {
    Napi::EscapableHandleScope scope(env);

    auto track = factory->createDataTrack(options);

    Napi::Object obj = constructor_.New({});
    LocalDataTrackWrap* wrap = Napi::ObjectWrap<LocalDataTrackWrap>::Unwrap(obj);
    wrap->track_ = track;
    wrap->max_packet_life_time_ = options.getMaxPacketLifeTime();
    wrap->max_retransmits_ = options.getMaxRetransmits();

    // Observe send completions so send() can report the outcome. Without this
    // an oversize or undeliverable message is a silent no-op.
    wrap->asyncContext_ = std::make_unique<AsyncContext>(env, 0 /* unbounded: send
        results are small and must not be dropped */);
    wrap->observer_ = std::make_shared<LocalDataTrackSendObserver>(wrap);
    track->setObserver(wrap->observer_);

    return scope.Escape(obj).ToObject();
}

LocalDataTrackWrap::LocalDataTrackWrap(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<LocalDataTrackWrap>(info) {
}

LocalDataTrackWrap::~LocalDataTrackWrap() {
    if (observer_) observer_->detach();
    if (asyncContext_) asyncContext_->close();
}

void LocalDataTrackWrap::settleSend(uint64_t id, bool ok, const std::string& error) {
    auto it = pendingSends_.find(id);
    if (it == pendingSends_.end()) return;

    Napi::Promise::Deferred deferred = it->second;
    pendingSends_.erase(it);

    Napi::Env env = deferred.Env();
    Napi::HandleScope scope(env);
    auto result = Napi::Object::New(env);
    result.Set("ok", Napi::Boolean::New(env, ok));
    result.Set("messageId", Napi::Number::New(env, static_cast<double>(id)));
    if (!ok) result.Set("error", Napi::String::New(env, error));
    // Always resolves, never rejects: a fire-and-forget send() must not produce
    // an unhandled rejection.
    deferred.Resolve(result);
}

Napi::Value LocalDataTrackWrap::GetKind(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), "data");
}

Napi::Value LocalDataTrackWrap::GetName(const Napi::CallbackInfo& info) {
    if (!track_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), track_->getName());
}

Napi::Value LocalDataTrackWrap::GetMaxPacketLifeTime(const Napi::CallbackInfo& info) {
    return RequestedOptionOrNull(info.Env(), max_packet_life_time_);
}

Napi::Value LocalDataTrackWrap::GetMaxRetransmits(const Napi::CallbackInfo& info) {
    return RequestedOptionOrNull(info.Env(), max_retransmits_);
}

Napi::Value LocalDataTrackWrap::IsReliable(const Napi::CallbackInfo& info) {
    if (!track_) return Napi::Boolean::New(info.Env(), false);
    return Napi::Boolean::New(info.Env(), track_->isReliable());
}

Napi::Value LocalDataTrackWrap::IsOrdered(const Napi::CallbackInfo& info) {
    if (!track_) return Napi::Boolean::New(info.Env(), false);
    return Napi::Boolean::New(info.Env(), track_->isOrdered());
}

Napi::Value LocalDataTrackWrap::Send(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!track_) {
        Napi::Error::New(env, "Track not initialized").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected 1 argument").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    constexpr size_t kMaxMessageSize = twilio::media::LocalDataTrack::kMaxMessageSize;

    twilio::media::LocalDataTrackMessageId id;
    if (info[0].IsString()) {
        std::string message = info[0].As<Napi::String>().Utf8Value();
        // rtc-cpp drops an oversize message and reports it asynchronously;
        // rejecting at the boundary makes it a programming error the caller
        // sees immediately, with the actual size in the message.
        if (message.size() > kMaxMessageSize) {
            Napi::RangeError::New(env,
                "Data track message is " + std::to_string(message.size()) +
                " bytes, which exceeds the " + std::to_string(kMaxMessageSize) +
                "-byte maximum")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
        id = track_->send(message);
    } else if (info[0].IsBuffer()) {
        auto buffer = info[0].As<Napi::Buffer<uint8_t>>();
        if (buffer.Length() > kMaxMessageSize) {
            Napi::RangeError::New(env,
                "Data track message is " + std::to_string(buffer.Length()) +
                " bytes, which exceeds the " + std::to_string(kMaxMessageSize) +
                "-byte maximum")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
        id = track_->send(buffer.Data(), buffer.Length());
    } else {
        Napi::TypeError::New(env, "Argument must be string or Buffer").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto deferred = Napi::Promise::Deferred::New(env);
    pendingSends_.emplace(static_cast<uint64_t>(id), deferred);
    return deferred.Promise();
}

}
