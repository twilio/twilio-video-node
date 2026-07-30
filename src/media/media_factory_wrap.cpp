#include "media_factory_wrap.h"
#include "local_video_track_wrap.h"
#include "local_audio_track_wrap.h"
#include "local_data_track_wrap.h"
#include "../common/napi_options.h"
#include <twilio/media/data_track_options.h>
#include <atomic>
#include <optional>

namespace twilio_video_node {

namespace {
// Unique fallback name (e.g. "video-0") for an unnamed track, since two tracks
// with the same name can't both be published.
std::string nextDefaultName(const std::string& kind) {
    static std::atomic<uint64_t> counter{0};
    return kind + "-" + std::to_string(counter.fetch_add(1, std::memory_order_relaxed));
}
}  // namespace

Napi::FunctionReference MediaFactoryWrap::constructor_;

void MediaFactoryWrap::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "MediaFactory", {
        InstanceMethod("createVideoTrack", &MediaFactoryWrap::CreateVideoTrack),
        InstanceMethod("createAudioTrack", &MediaFactoryWrap::CreateAudioTrack),
        InstanceMethod("createDataTrack", &MediaFactoryWrap::CreateDataTrack),
    });

    constructor_ = Napi::Persistent(func);
    constructor_.SuppressDestruct();
    exports.Set("MediaFactory", func);
}

Napi::Object MediaFactoryWrap::NewInstance(Napi::Env env, std::shared_ptr<twilio::media::MediaFactory> factory) {
    Napi::Object obj = constructor_.New({});
    MediaFactoryWrap* wrap = Napi::ObjectWrap<MediaFactoryWrap>::Unwrap(obj);
    wrap->factory_ = factory;
    return obj;
}

bool MediaFactoryWrap::IsInstance(Napi::Object obj) {
    return obj.InstanceOf(constructor_.Value());
}

MediaFactoryWrap::MediaFactoryWrap(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<MediaFactoryWrap>(info) {
    Napi::Env env = info.Env();
    asyncContext_ = std::make_unique<AsyncContext>(env);

    auto options = std::make_unique<twilio::media::MediaOptions>();
    options->audio_device_factory = [this](webrtc::TaskQueueFactory* task_queue_factory) {
        adm_ = NodeAudioDevice::Create(task_queue_factory);
        return rtc::scoped_refptr<webrtc::AudioDeviceModule>(adm_);
    };
    factory_ = twilio::media::MediaFactory::create(std::move(options));
}

MediaFactoryWrap::~MediaFactoryWrap() {
    if (asyncContext_) {
        asyncContext_->close();
    }
}

Napi::Value MediaFactoryWrap::CreateVideoTrack(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    std::optional<std::string> name;
    if (info.Length() > 0 && info[0].IsObject()) {
        auto options = info[0].As<Napi::Object>();
        if (!ReadOptionalString(env, options, "name", name)) return env.Undefined();
    }

    twilio::media::VideoTrackOptions trackOptions(true, name ? *name : nextDefaultName("video"));
    return LocalVideoTrackWrap::NewInstance(env, factory_, trackOptions);
}

Napi::Value MediaFactoryWrap::CreateAudioTrack(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    std::optional<std::string> name;
    if (info.Length() > 0 && info[0].IsObject()) {
        auto options = info[0].As<Napi::Object>();
        if (!ReadOptionalString(env, options, "name", name)) return env.Undefined();
    }

    twilio::media::AudioTrackOptions trackOptions(true, name ? *name : nextDefaultName("audio"));
    return LocalAudioTrackWrap::NewInstance(env, factory_, trackOptions, adm_);
}

Napi::Value MediaFactoryWrap::CreateDataTrack(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    twilio::media::DataTrackOptions::Builder builder;
    std::optional<std::string> name;

    if (info.Length() > 0 && info[0].IsObject()) {
        auto options = info[0].As<Napi::Object>();
        std::optional<int32_t> maxPacketLifeTime;
        std::optional<int32_t> maxRetransmits;
        std::optional<bool> ordered;
        if (!ReadOptionalString(env, options, "name", name) ||
            !ReadOptionalInt32(env, options, "maxPacketLifeTime", maxPacketLifeTime) ||
            !ReadOptionalInt32(env, options, "maxRetransmits", maxRetransmits) ||
            !ReadOptionalBool(env, options, "ordered", ordered)) {
            return env.Undefined();
        }
        // Each setter is called only when the caller set it, so an unset limit
        // keeps the builder's "no limit" default rather than becoming a value.
        if (maxPacketLifeTime) builder.setMaxPacketLifeTime(*maxPacketLifeTime);
        if (maxRetransmits) builder.setMaxRetransmits(*maxRetransmits);
        if (ordered) builder.setOrdered(*ordered);
    }

    builder.setName(name ? *name : nextDefaultName("data"));
    twilio::media::DataTrackOptions trackOptions = builder.build();
    return LocalDataTrackWrap::NewInstance(env, factory_, trackOptions);
}

}
