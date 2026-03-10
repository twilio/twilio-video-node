#include "media_factory_wrap.h"
#include "local_video_track_wrap.h"
#include "local_audio_track_wrap.h"
#include "local_data_track_wrap.h"
#include <twilio/media/data_track_options.h>

namespace twilio_video_node {

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

    std::string name = "video";
    if (info.Length() > 0 && info[0].IsObject()) {
        auto options = info[0].As<Napi::Object>();
        if (options.Has("name")) {
            name = options.Get("name").As<Napi::String>().Utf8Value();
        }
    }

    twilio::media::VideoTrackOptions trackOptions(true, name);
    return LocalVideoTrackWrap::NewInstance(env, factory_, trackOptions);
}

Napi::Value MediaFactoryWrap::CreateAudioTrack(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    std::string name = "audio";
    if (info.Length() > 0 && info[0].IsObject()) {
        auto options = info[0].As<Napi::Object>();
        if (options.Has("name")) {
            name = options.Get("name").As<Napi::String>().Utf8Value();
        }
    }

    twilio::media::AudioTrackOptions trackOptions(true, name);
    return LocalAudioTrackWrap::NewInstance(env, factory_, trackOptions, adm_);
}

Napi::Value MediaFactoryWrap::CreateDataTrack(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    twilio::media::DataTrackOptions::Builder builder;

    if (info.Length() > 0 && info[0].IsObject()) {
        auto options = info[0].As<Napi::Object>();
        if (options.Has("name")) {
            builder.setName(options.Get("name").As<Napi::String>().Utf8Value());
        }
        if (options.Has("maxPacketLifeTime")) {
            builder.setMaxPacketLifeTime(options.Get("maxPacketLifeTime").As<Napi::Number>().Int32Value());
        }
        if (options.Has("maxRetransmits")) {
            builder.setMaxRetransmits(options.Get("maxRetransmits").As<Napi::Number>().Int32Value());
        }
        if (options.Has("ordered")) {
            builder.setOrdered(options.Get("ordered").As<Napi::Boolean>().Value());
        }
    }

    twilio::media::DataTrackOptions trackOptions = builder.build();
    return LocalDataTrackWrap::NewInstance(env, factory_, trackOptions);
}

}
