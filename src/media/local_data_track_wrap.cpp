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

    return scope.Escape(obj).ToObject();
}

LocalDataTrackWrap::LocalDataTrackWrap(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<LocalDataTrackWrap>(info) {
}

LocalDataTrackWrap::~LocalDataTrackWrap() {
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

    if (info[0].IsString()) {
        std::string message = info[0].As<Napi::String>().Utf8Value();
        track_->send(message);
    } else if (info[0].IsBuffer()) {
        auto buffer = info[0].As<Napi::Buffer<uint8_t>>();
        track_->send(buffer.Data(), buffer.Length());
    } else {
        Napi::TypeError::New(env, "Argument must be string or Buffer").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    return env.Undefined();
}

}
