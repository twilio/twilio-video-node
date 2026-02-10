#include "room_wrap.h"
#include "local_participant_wrap.h"
#include "remote_participant_wrap.h"
#include "../media/media_factory_wrap.h"
#include "../media/local_video_track_wrap.h"
#include "../media/local_audio_track_wrap.h"
#include "../media/local_data_track_wrap.h"
#include "../common/error.h"

#include "twilio/log.h"

#ifdef __APPLE__
#include <dispatch/dispatch.h>
#endif

namespace twilio_video_node {

Napi::FunctionReference RoomWrap::constructor_;

void RoomWrap::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "Room", {
        InstanceAccessor("name", &RoomWrap::GetName, nullptr),
        InstanceAccessor("sid", &RoomWrap::GetSid, nullptr),
        InstanceAccessor("state", &RoomWrap::GetState, nullptr),
        InstanceAccessor("mediaRegion", &RoomWrap::GetMediaRegion, nullptr),
        InstanceAccessor("isRecording", &RoomWrap::IsRecording, nullptr),
        InstanceAccessor("localParticipant", &RoomWrap::GetLocalParticipant, nullptr),
        InstanceAccessor("remoteParticipants", &RoomWrap::GetRemoteParticipants, nullptr),
        InstanceMethod("disconnect", &RoomWrap::Disconnect),
        InstanceMethod("on", &RoomWrap::On),
        InstanceMethod("off", &RoomWrap::Off),
    });

    constructor_ = Napi::Persistent(func);
    constructor_.SuppressDestruct();
    exports.Set("Room", func);

    exports.Set("connect", Napi::Function::New(env, RoomWrap::Connect));
}

Napi::Value RoomWrap::Connect(const Napi::CallbackInfo& info) {
    printf("[C++] RoomWrap::Connect() ENTERED\n");
    fflush(stdout);
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "Expected options object").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object obj = constructor_.New({});
    RoomWrap* roomWrap = Napi::ObjectWrap<RoomWrap>::Unwrap(obj);

    fprintf(stderr, "[C++] Creating RoomObserverWrap...\n");
    roomWrap->observer_ = std::make_shared<RoomObserverWrap>(env, roomWrap);
    fprintf(stderr, "[C++] RoomObserverWrap created, use_count=%ld, ptr=%p\n",
            roomWrap->observer_.use_count(), roomWrap->observer_.get());
    roomWrap->asyncContext_ = std::make_unique<AsyncContext>(env);

    auto optionsObj = info[0].As<Napi::Object>();

    if (!optionsObj.Has("token") || !optionsObj.Get("token").IsString()) {
        Napi::TypeError::New(env, "token is required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string token = optionsObj.Get("token").As<Napi::String>().Utf8Value();
    twilio::video::ConnectOptions::Builder builder(token);

    if (optionsObj.Has("roomName")) {
        builder.setRoomName(optionsObj.Get("roomName").As<Napi::String>().Utf8Value());
    }

    std::shared_ptr<twilio::media::MediaFactory> mediaFactory;

    // Accept mediaFactory directly (needed when connecting without tracks)
    if (optionsObj.Has("mediaFactory") && optionsObj.Get("mediaFactory").IsObject()) {
        auto factoryObj = optionsObj.Get("mediaFactory").As<Napi::Object>();
        auto* factoryWrap = Napi::ObjectWrap<MediaFactoryWrap>::Unwrap(factoryObj);
        if (factoryWrap) {
            mediaFactory = factoryWrap->getFactory();
            builder.setMediaFactory(mediaFactory);
        }
    }

    // Fallback: extract MediaFactory from tracks if not provided directly
    if (!mediaFactory && optionsObj.Has("videoTracks") && optionsObj.Get("videoTracks").IsArray()) {
        auto tracks = optionsObj.Get("videoTracks").As<Napi::Array>();
        if (tracks.Length() > 0) {
            auto trackObj = tracks.Get(uint32_t(0)).As<Napi::Object>();
            auto* trackWrap = Napi::ObjectWrap<LocalVideoTrackWrap>::Unwrap(trackObj);
            if (trackWrap) {
                mediaFactory = trackWrap->getFactory();
                if (mediaFactory) {
                    builder.setMediaFactory(mediaFactory);
                }
            }
        }
    }
    if (!mediaFactory && optionsObj.Has("audioTracks") && optionsObj.Get("audioTracks").IsArray()) {
        auto tracks = optionsObj.Get("audioTracks").As<Napi::Array>();
        if (tracks.Length() > 0) {
            auto trackObj = tracks.Get(uint32_t(0)).As<Napi::Object>();
            auto* trackWrap = Napi::ObjectWrap<LocalAudioTrackWrap>::Unwrap(trackObj);
            if (trackWrap) {
                mediaFactory = trackWrap->getFactory();
                if (mediaFactory) {
                    builder.setMediaFactory(mediaFactory);
                }
            }
        }
    }

    fprintf(stderr, "[C++] About to set builder options...\n");

    // Disable insights for now to simplify demo
    builder.enableInsights(false);

    if (optionsObj.Has("enableInsights")) {
        builder.enableInsights(optionsObj.Get("enableInsights").As<Napi::Boolean>().Value());
    }

    if (optionsObj.Has("enableAutomaticSubscription")) {
        builder.enableAutomaticSubscription(optionsObj.Get("enableAutomaticSubscription").As<Napi::Boolean>().Value());
    }

    if (optionsObj.Has("enableDominantSpeaker")) {
        builder.enableDominantSpeaker(optionsObj.Get("enableDominantSpeaker").As<Napi::Boolean>().Value());
    }

    if (optionsObj.Has("enableNetworkQuality")) {
        builder.enableNetworkQuality(optionsObj.Get("enableNetworkQuality").As<Napi::Boolean>().Value());
    }

    if (optionsObj.Has("region")) {
        builder.setRegion(optionsObj.Get("region").As<Napi::String>().Utf8Value());
    }

    fprintf(stderr, "[C++] Setting platform info...\n");
    twilio::PlatformInfo platformInfo;
    platformInfo.sdkVersion = "1.0.0";
    platformInfo.platformName = "nodejs";
    platformInfo.platformVersion = "24.0.0";
    platformInfo.hwDeviceArch = "x86_64";
    platformInfo.hwDeviceManufacturer = "Server";
    platformInfo.hwDeviceModel = "MediaStreams";

    if (optionsObj.Has("platformInfo") && optionsObj.Get("platformInfo").IsObject()) {
        auto pi = optionsObj.Get("platformInfo").As<Napi::Object>();
        if (pi.Has("sdkVersion")) platformInfo.sdkVersion = pi.Get("sdkVersion").As<Napi::String>().Utf8Value();
        if (pi.Has("platformName")) platformInfo.platformName = pi.Get("platformName").As<Napi::String>().Utf8Value();
        if (pi.Has("platformVersion")) platformInfo.platformVersion = pi.Get("platformVersion").As<Napi::String>().Utf8Value();
    }
    builder.setPlatformInfo(platformInfo);
    fprintf(stderr, "[C++] Platform info set\n");

    fprintf(stderr, "[C++] About to add tracks...\n");
    // Add video tracks
    if (optionsObj.Has("videoTracks") && optionsObj.Get("videoTracks").IsArray()) {
        auto tracks = optionsObj.Get("videoTracks").As<Napi::Array>();
        std::vector<std::shared_ptr<twilio::media::LocalVideoTrack>> videoTracks;
        for (uint32_t i = 0; i < tracks.Length(); i++) {
            auto trackObj = tracks.Get(i).As<Napi::Object>();
            auto* trackWrap = Napi::ObjectWrap<LocalVideoTrackWrap>::Unwrap(trackObj);
            if (trackWrap) {
                videoTracks.push_back(trackWrap->getTrack());
            }
        }
        builder.setVideoTracks(videoTracks);
    }

    // Add audio tracks
    if (optionsObj.Has("audioTracks") && optionsObj.Get("audioTracks").IsArray()) {
        auto tracks = optionsObj.Get("audioTracks").As<Napi::Array>();
        std::vector<std::shared_ptr<twilio::media::LocalAudioTrack>> audioTracks;
        for (uint32_t i = 0; i < tracks.Length(); i++) {
            auto trackObj = tracks.Get(i).As<Napi::Object>();
            auto* trackWrap = Napi::ObjectWrap<LocalAudioTrackWrap>::Unwrap(trackObj);
            if (trackWrap) {
                audioTracks.push_back(trackWrap->getTrack());
            }
        }
        builder.setAudioTracks(audioTracks);
    }

    // Add data tracks
    if (optionsObj.Has("dataTracks") && optionsObj.Get("dataTracks").IsArray()) {
        auto tracks = optionsObj.Get("dataTracks").As<Napi::Array>();
        std::vector<std::shared_ptr<twilio::media::LocalDataTrack>> dataTracks;
        for (uint32_t i = 0; i < tracks.Length(); i++) {
            auto trackObj = tracks.Get(i).As<Napi::Object>();
            auto* trackWrap = Napi::ObjectWrap<LocalDataTrackWrap>::Unwrap(trackObj);
            if (trackWrap) {
                dataTracks.push_back(trackWrap->getTrack());
            }
        }
        builder.setDataTracks(dataTracks);
    }

    auto connectOptions = builder.build();

    // connect() expects std::weak_ptr<RoomObserver>
    // Cast to base class to ensure proper type conversion
    std::shared_ptr<twilio::video::RoomObserver> observer = std::static_pointer_cast<twilio::video::RoomObserver>(roomWrap->observer_);
    fprintf(stderr, "[C++] Calling twilio::video::connect with observer (use_count=%ld, observer_ptr=%p)\n",
            observer.use_count(), observer.get());
    setLogLevel(twilio::LogLevel::kDebug);  // Temporarily set to DEBUG to see observer callbacks
    roomWrap->room_ = twilio::video::connect(connectOptions, observer);
    fprintf(stderr, "[C++] twilio::video::connect returned, room=%p\n", roomWrap->room_.get());

    if (!roomWrap->room_) {
        Napi::Error::New(env, "Failed to create room").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    return obj;
}

RoomWrap::RoomWrap(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<RoomWrap>(info) {
}

RoomWrap::~RoomWrap() {
    if (observer_) {
        observer_->close();
    }
    if (room_) {
        room_->disconnect();
    }
    if (asyncContext_) {
        asyncContext_->close();
    }
}

void RoomWrap::emitEvent(const std::string& eventName, Napi::Value arg) {
    fprintf(stderr, "[C++] RoomWrap::emitEvent('%s') called\n", eventName.c_str());
    auto it = eventListeners_.find(eventName);
    if (it == eventListeners_.end()) {
        fprintf(stderr, "[C++] RoomWrap::emitEvent('%s') - NO LISTENERS REGISTERED\n", eventName.c_str());
        return;
    }

    fprintf(stderr, "[C++] RoomWrap::emitEvent('%s') - found %zu listeners\n", eventName.c_str(), it->second.size());
    for (auto& listener : it->second) {
        if (!listener.IsEmpty()) {
            fprintf(stderr, "[C++] RoomWrap::emitEvent('%s') - calling listener\n", eventName.c_str());
            if (arg.IsEmpty() || arg.IsUndefined()) {
                listener.Call({});
            } else {
                listener.Call({arg});
            }
            fprintf(stderr, "[C++] RoomWrap::emitEvent('%s') - listener returned\n", eventName.c_str());
        }
    }
    fprintf(stderr, "[C++] RoomWrap::emitEvent('%s') - all listeners called\n", eventName.c_str());
}

Napi::Value RoomWrap::GetName(const Napi::CallbackInfo& info) {
    if (!room_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), room_->getName());
}

Napi::Value RoomWrap::GetSid(const Napi::CallbackInfo& info) {
    if (!room_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), room_->getSid());
}

Napi::Value RoomWrap::GetState(const Napi::CallbackInfo& info) {
    if (!room_) return Napi::String::New(info.Env(), "disconnected");

    switch (room_->getState()) {
        case twilio::video::Room::State::kConnecting:
            return Napi::String::New(info.Env(), "connecting");
        case twilio::video::Room::State::kConnected:
            return Napi::String::New(info.Env(), "connected");
        case twilio::video::Room::State::kReconnecting:
            return Napi::String::New(info.Env(), "reconnecting");
        case twilio::video::Room::State::kDisconnected:
        default:
            return Napi::String::New(info.Env(), "disconnected");
    }
}

Napi::Value RoomWrap::GetMediaRegion(const Napi::CallbackInfo& info) {
    if (!room_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), room_->getMediaRegion());
}

Napi::Value RoomWrap::IsRecording(const Napi::CallbackInfo& info) {
    if (!room_) return Napi::Boolean::New(info.Env(), false);
    return Napi::Boolean::New(info.Env(), room_->isRecording());
}

Napi::Value RoomWrap::GetLocalParticipant(const Napi::CallbackInfo& info) {
    if (!room_) return info.Env().Undefined();
    auto participant = room_->getLocalParticipant();
    if (!participant) return info.Env().Undefined();
    return LocalParticipantWrap::NewInstance(info.Env(), participant);
}

Napi::Value RoomWrap::GetRemoteParticipants(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!room_) return Napi::Array::New(env, 0);

    auto participants = room_->getRemoteParticipants();
    auto array = Napi::Array::New(env, participants.size());

    uint32_t i = 0;
    for (const auto& pair : participants) {
        array.Set(i++, RemoteParticipantWrap::NewInstance(env, pair.second));
    }

    return array;
}

Napi::Value RoomWrap::Disconnect(const Napi::CallbackInfo& info) {
    if (room_) {
        room_->disconnect();
    }
    return info.Env().Undefined();
}

Napi::Value RoomWrap::On(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsFunction()) {
        Napi::TypeError::New(env, "Expected event name and callback").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string eventName = info[0].As<Napi::String>().Utf8Value();
    auto callback = info[1].As<Napi::Function>();

    eventListeners_[eventName].push_back(Napi::Persistent(callback));
    fprintf(stderr, "[C++] RoomWrap::On('%s') - listener registered (total: %zu)\n",
            eventName.c_str(), eventListeners_[eventName].size());

    return info.This();
}

Napi::Value RoomWrap::Off(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected event name").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string eventName = info[0].As<Napi::String>().Utf8Value();

    if (info.Length() < 2 || !info[1].IsFunction()) {
        eventListeners_.erase(eventName);
    } else {
        auto& listeners = eventListeners_[eventName];
        listeners.clear();
    }

    return info.This();
}

}
