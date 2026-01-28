#include "connect_options_wrap.h"
#include "../media/media_factory_wrap.h"
#include "../media/local_video_track_wrap.h"
#include "../media/local_audio_track_wrap.h"
#include "../media/local_data_track_wrap.h"

namespace twilio_video_node {

Napi::FunctionReference ConnectOptionsWrap::constructor_;

void ConnectOptionsWrap::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "ConnectOptions", {});

    constructor_ = Napi::Persistent(func);
    constructor_.SuppressDestruct();
    exports.Set("ConnectOptions", func);
}

ConnectOptionsWrap::ConnectOptionsWrap(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<ConnectOptionsWrap>(info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "Expected options object").ThrowAsJavaScriptException();
        return;
    }

    auto options = info[0].As<Napi::Object>();

    if (!options.Has("token") || !options.Get("token").IsString()) {
        Napi::TypeError::New(env, "token is required").ThrowAsJavaScriptException();
        return;
    }
    accessToken_ = options.Get("token").As<Napi::String>().Utf8Value();

    if (options.Has("roomName")) {
        roomName_ = options.Get("roomName").As<Napi::String>().Utf8Value();
    }

    if (options.Has("mediaFactory") && options.Get("mediaFactory").IsObject()) {
        auto factoryObj = options.Get("mediaFactory").As<Napi::Object>();
        auto* factoryWrap = Napi::ObjectWrap<MediaFactoryWrap>::Unwrap(factoryObj);
        if (factoryWrap) {
            mediaFactory_ = factoryWrap->getFactory();
        }
    }

    if (options.Has("videoTracks") && options.Get("videoTracks").IsArray()) {
        auto tracks = options.Get("videoTracks").As<Napi::Array>();
        for (uint32_t i = 0; i < tracks.Length(); i++) {
            auto trackObj = tracks.Get(i).As<Napi::Object>();
            auto* trackWrap = Napi::ObjectWrap<LocalVideoTrackWrap>::Unwrap(trackObj);
            if (trackWrap) {
                videoTracks_.push_back(trackWrap->getTrack());
            }
        }
    }

    if (options.Has("audioTracks") && options.Get("audioTracks").IsArray()) {
        auto tracks = options.Get("audioTracks").As<Napi::Array>();
        for (uint32_t i = 0; i < tracks.Length(); i++) {
            auto trackObj = tracks.Get(i).As<Napi::Object>();
            auto* trackWrap = Napi::ObjectWrap<LocalAudioTrackWrap>::Unwrap(trackObj);
            if (trackWrap) {
                audioTracks_.push_back(trackWrap->getTrack());
            }
        }
    }

    if (options.Has("dataTracks") && options.Get("dataTracks").IsArray()) {
        auto tracks = options.Get("dataTracks").As<Napi::Array>();
        for (uint32_t i = 0; i < tracks.Length(); i++) {
            auto trackObj = tracks.Get(i).As<Napi::Object>();
            auto* trackWrap = Napi::ObjectWrap<LocalDataTrackWrap>::Unwrap(trackObj);
            if (trackWrap) {
                dataTracks_.push_back(trackWrap->getTrack());
            }
        }
    }

    if (options.Has("enableInsights")) {
        enableInsights_ = options.Get("enableInsights").As<Napi::Boolean>().Value();
    }

    if (options.Has("enableAutomaticSubscription")) {
        enableAutomaticSubscription_ = options.Get("enableAutomaticSubscription").As<Napi::Boolean>().Value();
    }

    if (options.Has("enableDominantSpeaker")) {
        enableDominantSpeaker_ = options.Get("enableDominantSpeaker").As<Napi::Boolean>().Value();
    }

    if (options.Has("enableNetworkQuality")) {
        enableNetworkQuality_ = options.Get("enableNetworkQuality").As<Napi::Boolean>().Value();
    }

    if (options.Has("region")) {
        region_ = options.Get("region").As<Napi::String>().Utf8Value();
    }

    if (options.Has("platformInfo") && options.Get("platformInfo").IsObject()) {
        auto platformInfo = options.Get("platformInfo").As<Napi::Object>();
        if (platformInfo.Has("sdkVersion")) {
            platformInfo_.sdkVersion = platformInfo.Get("sdkVersion").As<Napi::String>().Utf8Value();
        }
        if (platformInfo.Has("platformName")) {
            platformInfo_.platformName = platformInfo.Get("platformName").As<Napi::String>().Utf8Value();
        }
        if (platformInfo.Has("platformVersion")) {
            platformInfo_.platformVersion = platformInfo.Get("platformVersion").As<Napi::String>().Utf8Value();
        }
        if (platformInfo.Has("deviceArchitecture")) {
            platformInfo_.hwDeviceArch = platformInfo.Get("deviceArchitecture").As<Napi::String>().Utf8Value();
        }
        if (platformInfo.Has("deviceManufacturer")) {
            platformInfo_.hwDeviceManufacturer = platformInfo.Get("deviceManufacturer").As<Napi::String>().Utf8Value();
        }
        if (platformInfo.Has("deviceModel")) {
            platformInfo_.hwDeviceModel = platformInfo.Get("deviceModel").As<Napi::String>().Utf8Value();
        }
    } else {
        platformInfo_.sdkVersion = "1.0.0";
        platformInfo_.platformName = "nodejs";
        platformInfo_.platformVersion = "24.0.0";
        platformInfo_.hwDeviceArch = "x86_64";
        platformInfo_.hwDeviceManufacturer = "Server";
        platformInfo_.hwDeviceModel = "MediaStreams";
    }
}

ConnectOptionsWrap::~ConnectOptionsWrap() {
}

twilio::video::ConnectOptions ConnectOptionsWrap::build() {
    twilio::video::ConnectOptions::Builder builder(accessToken_);

    builder.setRoomName(roomName_);
    builder.setVideoTracks(videoTracks_);
    builder.setAudioTracks(audioTracks_);
    builder.setDataTracks(dataTracks_);
    builder.enableInsights(enableInsights_);
    builder.enableAutomaticSubscription(enableAutomaticSubscription_);
    builder.enableDominantSpeaker(enableDominantSpeaker_);
    builder.enableNetworkQuality(enableNetworkQuality_);
    builder.setRegion(region_);
    builder.setPlatformInfo(platformInfo_);

    if (mediaFactory_) {
        builder.setMediaFactory(mediaFactory_);
    }

    return builder.build();
}

}
