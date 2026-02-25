#include "room_wrap.h"
#include "local_participant_wrap.h"
#include "remote_participant_wrap.h"
#include "../media/media_factory_wrap.h"
#include "../media/local_video_track_wrap.h"
#include "../media/local_audio_track_wrap.h"
#include "../media/local_data_track_wrap.h"
#include "../common/error.h"

#include <twilio/media/ice_options.h>

#ifdef __APPLE__
#include <CoreFoundation/CoreFoundation.h>
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
        InstanceMethod("dispose", &RoomWrap::Dispose),
        InstanceMethod("on", &RoomWrap::On),
        InstanceMethod("off", &RoomWrap::Off),
    });

    constructor_ = Napi::Persistent(func);
    constructor_.SuppressDestruct();
    exports.Set("Room", func);

    exports.Set("connect", Napi::Function::New(env, RoomWrap::Connect));
}

Napi::Value RoomWrap::Connect(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Token must be a string").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Create the Room JS object
    Napi::Object obj = constructor_.New({});
    RoomWrap* roomWrap = Napi::ObjectWrap<RoomWrap>::Unwrap(obj);

    roomWrap->observer_ = std::make_shared<RoomObserverWrap>(env, roomWrap);
    roomWrap->asyncContext_ = std::make_unique<AsyncContext>(env, 0);

    std::string token = info[0].As<Napi::String>().Utf8Value();
    twilio::video::ConnectOptions::Builder builder(token);

    auto optionsObj = (info.Length() >= 2 && info[1].IsObject())
        ? info[1].As<Napi::Object>()
        : Napi::Object::New(env);

    if (optionsObj.Has("name")) {
        builder.setRoomName(optionsObj.Get("name").As<Napi::String>().Utf8Value());
    }

    // MediaFactory
    std::shared_ptr<twilio::media::MediaFactory> mediaFactory;

    if (optionsObj.Has("mediaFactory") && optionsObj.Get("mediaFactory").IsObject()) {
        auto factoryObj = optionsObj.Get("mediaFactory").As<Napi::Object>();
        auto* factoryWrap = Napi::ObjectWrap<MediaFactoryWrap>::Unwrap(factoryObj);
        if (factoryWrap) {
            mediaFactory = factoryWrap->getFactory();
            builder.setMediaFactory(mediaFactory);
        }
    }

    // Fallback: extract MediaFactory from tracks
    if (!mediaFactory && optionsObj.Has("videoTracks") && optionsObj.Get("videoTracks").IsArray()) {
        auto tracks = optionsObj.Get("videoTracks").As<Napi::Array>();
        if (tracks.Length() > 0) {
            auto trackObj = tracks.Get(uint32_t(0)).As<Napi::Object>();
            auto* trackWrap = Napi::ObjectWrap<LocalVideoTrackWrap>::Unwrap(trackObj);
            if (trackWrap && trackWrap->getFactory()) {
                mediaFactory = trackWrap->getFactory();
                builder.setMediaFactory(mediaFactory);
            }
        }
    }
    if (!mediaFactory && optionsObj.Has("audioTracks") && optionsObj.Get("audioTracks").IsArray()) {
        auto tracks = optionsObj.Get("audioTracks").As<Napi::Array>();
        if (tracks.Length() > 0) {
            auto trackObj = tracks.Get(uint32_t(0)).As<Napi::Object>();
            auto* trackWrap = Napi::ObjectWrap<LocalAudioTrackWrap>::Unwrap(trackObj);
            if (trackWrap && trackWrap->getFactory()) {
                mediaFactory = trackWrap->getFactory();
                builder.setMediaFactory(mediaFactory);
            }
        }
    }

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

    // ICE options
    if (optionsObj.Has("iceOptions") && optionsObj.Get("iceOptions").IsObject()) {
        auto iceObj = optionsObj.Get("iceOptions").As<Napi::Object>();
        twilio::media::IceOptions iceOptions;

        if (iceObj.Has("transportPolicy")) {
            std::string policy = iceObj.Get("transportPolicy").As<Napi::String>().Utf8Value();
            if (policy == "relay") {
                iceOptions.ice_transport_policy = twilio::media::IceTransportPolicy::kIceTransportPolicyRelay;
            } else {
                iceOptions.ice_transport_policy = twilio::media::IceTransportPolicy::kIceTransportPolicyAll;
            }
        }

        if (iceObj.Has("iceServers") && iceObj.Get("iceServers").IsArray()) {
            auto servers = iceObj.Get("iceServers").As<Napi::Array>();
            twilio::media::IceServers iceServers;
            for (uint32_t i = 0; i < servers.Length(); i++) {
                auto serverObj = servers.Get(i).As<Napi::Object>();
                twilio::media::IceServer server;
                if (serverObj.Has("urls") && serverObj.Get("urls").IsArray()) {
                    auto urls = serverObj.Get("urls").As<Napi::Array>();
                    for (uint32_t j = 0; j < urls.Length(); j++) {
                        server.urls.push_back(urls.Get(j).As<Napi::String>().Utf8Value());
                    }
                }
                if (serverObj.Has("username")) {
                    server.username = serverObj.Get("username").As<Napi::String>().Utf8Value();
                }
                if (serverObj.Has("credential")) {
                    server.password = serverObj.Get("credential").As<Napi::String>().Utf8Value();
                }
                iceServers.push_back(server);
            }
            iceOptions.ice_servers = iceServers;
        }

        builder.setIceOptions(iceOptions);
    }

    // Platform info
    twilio::PlatformInfo platformInfo;
    platformInfo.platformName = "nodejs";
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

    // Tracks
    if (optionsObj.Has("videoTracks") && optionsObj.Get("videoTracks").IsArray()) {
        auto tracks = optionsObj.Get("videoTracks").As<Napi::Array>();
        std::vector<std::shared_ptr<twilio::media::LocalVideoTrack>> videoTracks;
        for (uint32_t i = 0; i < tracks.Length(); i++) {
            auto trackObj = tracks.Get(i).As<Napi::Object>();
            auto* trackWrap = Napi::ObjectWrap<LocalVideoTrackWrap>::Unwrap(trackObj);
            if (trackWrap) videoTracks.push_back(trackWrap->getTrack());
        }
        builder.setVideoTracks(videoTracks);
    }

    if (optionsObj.Has("audioTracks") && optionsObj.Get("audioTracks").IsArray()) {
        auto tracks = optionsObj.Get("audioTracks").As<Napi::Array>();
        std::vector<std::shared_ptr<twilio::media::LocalAudioTrack>> audioTracks;
        for (uint32_t i = 0; i < tracks.Length(); i++) {
            auto trackObj = tracks.Get(i).As<Napi::Object>();
            auto* trackWrap = Napi::ObjectWrap<LocalAudioTrackWrap>::Unwrap(trackObj);
            if (trackWrap) audioTracks.push_back(trackWrap->getTrack());
        }
        builder.setAudioTracks(audioTracks);
    }

    if (optionsObj.Has("dataTracks") && optionsObj.Get("dataTracks").IsArray()) {
        auto tracks = optionsObj.Get("dataTracks").As<Napi::Array>();
        std::vector<std::shared_ptr<twilio::media::LocalDataTrack>> dataTracks;
        for (uint32_t i = 0; i < tracks.Length(); i++) {
            auto trackObj = tracks.Get(i).As<Napi::Object>();
            auto* trackWrap = Napi::ObjectWrap<LocalDataTrackWrap>::Unwrap(trackObj);
            if (trackWrap) dataTracks.push_back(trackWrap->getTrack());
        }
        builder.setDataTracks(dataTracks);
    }

    auto connectOptions = builder.build();

    std::shared_ptr<twilio::video::RoomObserver> observer =
        std::static_pointer_cast<twilio::video::RoomObserver>(roomWrap->observer_);
    roomWrap->room_ = twilio::video::connect(connectOptions, observer);

    if (!roomWrap->room_) {
        Napi::Error::New(env, "Failed to create room").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // On macOS, rtc-cpp posts work to dispatch_get_main_queue() which Node.js
    // doesn't pump. Start a libuv timer to drain all pending events frequently.
#ifdef __APPLE__
    uv_loop_t* loop;
    napi_get_uv_event_loop(env, &loop);
    roomWrap->mainQueueTimer_ = new uv_timer_t;
    uv_timer_init(loop, roomWrap->mainQueueTimer_);
    roomWrap->mainQueueTimer_->data = roomWrap;
    uv_timer_start(roomWrap->mainQueueTimer_, [](uv_timer_t*) {
        // Drain ALL pending main queue events, not just one
        while (CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.0, true) == kCFRunLoopRunHandledSource) {}
    }, 0, 10);
#endif

    return obj;
}

RoomWrap::RoomWrap(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<RoomWrap>(info) {
}

RoomWrap::~RoomWrap() {
    // Order: disconnect first (may trigger callbacks), then close observer, then close async
    if (room_) {
        room_->disconnect();
    }
    if (observer_) {
        observer_->close();
    }
    if (asyncContext_) {
        asyncContext_->close();
    }
    participantCache_.clear();

#ifdef __APPLE__
    if (mainQueueTimer_) {
        uv_timer_stop(mainQueueTimer_);
        uv_close(reinterpret_cast<uv_handle_t*>(mainQueueTimer_), [](uv_handle_t* h) {
            delete reinterpret_cast<uv_timer_t*>(h);
        });
        mainQueueTimer_ = nullptr;
    }
#endif
}

void RoomWrap::emitEvent(const std::string& eventName, Napi::Value arg) {
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

    // Track which SIDs are still present
    std::set<std::string> activeSids;

    uint32_t i = 0;
    for (const auto& pair : participants) {
        const std::string& sid = pair.first;
        activeSids.insert(sid);

        auto cacheIt = participantCache_.find(sid);
        if (cacheIt != participantCache_.end() && !cacheIt->second.IsEmpty()) {
            array.Set(i++, cacheIt->second.Value());
        } else {
            auto participantObj = RemoteParticipantWrap::NewInstance(env, pair.second);
            participantCache_[sid] = Napi::Persistent(participantObj);
            array.Set(i++, participantObj);
        }
    }

    // Evict stale entries
    for (auto it = participantCache_.begin(); it != participantCache_.end(); ) {
        if (activeSids.find(it->first) == activeSids.end()) {
            it = participantCache_.erase(it);
        } else {
            ++it;
        }
    }

    return array;
}

Napi::Value RoomWrap::Disconnect(const Napi::CallbackInfo& info) {
    if (room_) {
        room_->disconnect();
    }
    return info.Env().Undefined();
}

Napi::Value RoomWrap::Dispose(const Napi::CallbackInfo& info) {
    if (room_) {
        room_->disconnect();
    }
    if (observer_) {
        observer_->close();
        observer_.reset();
    }
    eventListeners_.clear();
    participantCache_.clear();
    if (asyncContext_) {
        asyncContext_->close();
        asyncContext_.reset();
    }
    room_.reset();

#ifdef __APPLE__
    if (mainQueueTimer_) {
        uv_timer_stop(mainQueueTimer_);
        uv_close(reinterpret_cast<uv_handle_t*>(mainQueueTimer_), [](uv_handle_t* h) {
            delete reinterpret_cast<uv_timer_t*>(h);
        });
        mainQueueTimer_ = nullptr;
    }
#endif

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
