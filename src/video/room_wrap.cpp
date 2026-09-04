#include "room_wrap.h"
#include "local_participant_wrap.h"
#include "remote_participant_wrap.h"
#include "../media/media_factory_wrap.h"
#include "../media/local_video_track_wrap.h"
#include "../media/local_audio_track_wrap.h"
#include "../media/local_data_track_wrap.h"
#include "../common/error.h"

#include <cmath>
#include <cstdint>
#include <string>

#include <twilio/media/codec.h>
#include <twilio/media/ice_options.h>
#include <twilio/video/bandwidth_profile.h>
#include <twilio/video/network_quality.h>

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
        InstanceAccessor("dominantSpeaker", &RoomWrap::GetDominantSpeaker, nullptr),
        InstanceAccessor("remoteParticipants", &RoomWrap::GetRemoteParticipants, nullptr),
        InstanceMethod("disconnect", &RoomWrap::Disconnect),
        InstanceMethod("dispose", &RoomWrap::Dispose),
        InstanceMethod("setEventCallback", &RoomWrap::SetEventCallback),
        InstanceMethod("getStats", &RoomWrap::GetStats),
    });

    constructor_ = Napi::Persistent(func);
    constructor_.SuppressDestruct();
    exports.Set("Room", func);

    exports.Set("connect", Napi::Function::New(env, RoomWrap::Connect));
}

// Reads and validates connect options into the builder. On invalid input it
// throws a JS TypeError/RangeError and returns false; the caller must bail
// (returning env.Undefined()) without inspecting the builder further. All
// type/range rejection happens here so Connect's try/catch only has to handle
// runtime failures from build()/connect().
static bool parseConnectOptions(Napi::Env env, const Napi::Object& opts,
                                twilio::video::ConnectOptions::Builder& builder) {
    // Rejects a present-but-wrong-typed scalar option with a TypeError. Absent
    // options are left to builder defaults.
    auto readString = [&](const char* field, std::string& out) -> bool {
        if (!opts.Has(field)) return true;
        Napi::Value value = opts.Get(field);
        if (!value.IsString()) {
            Napi::TypeError::New(env, std::string(field) + " must be a string").ThrowAsJavaScriptException();
            return false;
        }
        out = value.As<Napi::String>().Utf8Value();
        return true;
    };
    auto readBool = [&](const char* field, bool& out) -> bool {
        if (!opts.Has(field)) return true;
        Napi::Value value = opts.Get(field);
        if (!value.IsBoolean()) {
            Napi::TypeError::New(env, std::string(field) + " must be a boolean").ThrowAsJavaScriptException();
            return false;
        }
        out = value.As<Napi::Boolean>().Value();
        return true;
    };
    // For a present container/structured option, require the given type or throw.
    // Absent keys are left to builder defaults. `key` may be on a nested object;
    // `msg` is the full caller-facing message.
    auto requireType = [&](const Napi::Object& obj, const char* key, bool valid,
                           const char* msg) -> bool {
        if (obj.Has(key) && !valid) {
            Napi::TypeError::New(env, msg).ThrowAsJavaScriptException();
            return false;
        }
        return true;
    };

    std::string name;
    if (!readString("name", name)) return false;
    if (opts.Has("name")) builder.setRoomName(name);

    // MediaFactory (always provided by TS layer)
    if (!requireType(opts, "mediaFactory", opts.Get("mediaFactory").IsObject(),
                     "mediaFactory must be a MediaFactory instance")) return false;
    if (opts.Has("mediaFactory")) {
        auto factoryObj = opts.Get("mediaFactory").As<Napi::Object>();
        if (!MediaFactoryWrap::IsInstance(factoryObj)) {
            Napi::TypeError::New(env, "mediaFactory must be a MediaFactory instance").ThrowAsJavaScriptException();
            return false;
        }
        auto* factoryWrap = Napi::ObjectWrap<MediaFactoryWrap>::Unwrap(factoryObj);
        if (factoryWrap) builder.setMediaFactory(factoryWrap->getFactory());
    }

    bool flag;
    if (!readBool("enableInsights", flag)) return false;
    if (opts.Has("enableInsights")) builder.enableInsights(flag);
    if (!readBool("enableAutomaticSubscription", flag)) return false;
    if (opts.Has("enableAutomaticSubscription")) builder.enableAutomaticSubscription(flag);
    if (!readBool("enableDominantSpeaker", flag)) return false;
    if (opts.Has("enableDominantSpeaker")) builder.enableDominantSpeaker(flag);
    if (!readBool("enableNetworkQuality", flag)) return false;
    if (opts.Has("enableNetworkQuality")) builder.enableNetworkQuality(flag);
    if (!readBool("receiveTranscriptions", flag)) return false;
    if (opts.Has("receiveTranscriptions")) builder.receiveTranscriptions(flag);

    std::string region;
    if (!readString("region", region)) return false;
    if (opts.Has("region")) builder.setRegion(region);

    if (!requireType(opts, "networkQualityConfiguration",
                     opts.Get("networkQualityConfiguration").IsObject(),
                     "networkQualityConfiguration must be an object")) return false;
    if (opts.Has("networkQualityConfiguration")) {
        auto nqObj = opts.Get("networkQualityConfiguration").As<Napi::Object>();
        // rtc-cpp exposes only kNone(0)/kMinimal(1). The TS layer already validates this,
        // but a direct (JS) caller can reach here, so reject anything other than 0/1.
        auto readVerbosity = [&](const char* field, twilio::video::NetworkQualityVerbosity& out) -> bool {
            Napi::Value value = nqObj.Get(field);
            if (!value.IsNumber()) {
                Napi::TypeError::New(env, std::string("networkQualityConfiguration.") + field + " must be a number").ThrowAsJavaScriptException();
                return false;
            }
            double d = value.As<Napi::Number>().DoubleValue();
            if (d == 0) {
                out = twilio::video::NetworkQualityVerbosity::kNone;
            } else if (d == 1) {
                out = twilio::video::NetworkQualityVerbosity::kMinimal;
            } else {
                Napi::RangeError::New(env, std::string("networkQualityConfiguration.") + field + " must be 0 or 1").ThrowAsJavaScriptException();
                return false;
            }
            return true;
        };
        twilio::video::NetworkQualityConfiguration::Builder nqBuilder;
        if (nqObj.Has("local")) {
            twilio::video::NetworkQualityVerbosity local;
            if (!readVerbosity("local", local)) return false;
            nqBuilder.setLocalVerbosityLevel(local);
        }
        if (nqObj.Has("remote")) {
            twilio::video::NetworkQualityVerbosity remote;
            if (!readVerbosity("remote", remote)) return false;
            nqBuilder.setRemoteVerbosityLevel(remote);
        }
        builder.setNetworkQualityConfiguration(nqBuilder.build());
    }

    // Preferred audio codecs
    if (!requireType(opts, "preferredAudioCodecs", opts.Get("preferredAudioCodecs").IsArray(),
                     "preferredAudioCodecs must be an array")) return false;
    if (opts.Has("preferredAudioCodecs")) {
        auto codecs = opts.Get("preferredAudioCodecs").As<Napi::Array>();
        std::vector<std::shared_ptr<twilio::media::AudioCodec>> audioCodecs;
        for (uint32_t i = 0; i < codecs.Length(); i++) {
            auto el = codecs.Get(i);
            if (!el.IsString()) {
                Napi::TypeError::New(env, "preferredAudioCodecs entries must be strings").ThrowAsJavaScriptException();
                return false;
            }
            std::string n = el.As<Napi::String>().Utf8Value();
            if (n == "opus") audioCodecs.push_back(std::make_shared<twilio::media::OpusCodec>());
            else if (n == "PCMU") audioCodecs.push_back(std::make_shared<twilio::media::PcmuCodec>());
            else {
                Napi::TypeError::New(env, "Unknown audio codec: " + n).ThrowAsJavaScriptException();
                return false;
            }
        }
        builder.setPreferredAudioCodecs(audioCodecs);
    }

    // Preferred video codecs
    if (!requireType(opts, "preferredVideoCodecs", opts.Get("preferredVideoCodecs").IsArray(),
                     "preferredVideoCodecs must be an array")) return false;
    if (opts.Has("preferredVideoCodecs")) {
        auto codecs = opts.Get("preferredVideoCodecs").As<Napi::Array>();
        std::vector<std::shared_ptr<twilio::media::VideoCodec>> videoCodecs;
        for (uint32_t i = 0; i < codecs.Length(); i++) {
            auto el = codecs.Get(i);
            if (!el.IsString()) {
                Napi::TypeError::New(env, "preferredVideoCodecs entries must be strings").ThrowAsJavaScriptException();
                return false;
            }
            std::string n = el.As<Napi::String>().Utf8Value();
            if (n == "VP8") videoCodecs.push_back(std::make_shared<twilio::media::Vp8Codec>());
            else {
                Napi::TypeError::New(env, "Unknown video codec: " + n).ThrowAsJavaScriptException();
                return false;
            }
        }
        builder.setPreferredVideoCodecs(videoCodecs);
    }

    // Video encoding mode. Only "auto" is currently supported.
    if (opts.Has("videoEncodingMode")) {
        Napi::Value value = opts.Get("videoEncodingMode");
        if (!value.IsString()) {
            Napi::TypeError::New(env, "videoEncodingMode must be a string").ThrowAsJavaScriptException();
            return false;
        }
        std::string m = value.As<Napi::String>().Utf8Value();
        if (m == "auto") {
            builder.setVideoEncodingMode(twilio::media::VideoEncodingMode::kAuto);
        } else {
            Napi::TypeError::New(env, "Unknown videoEncodingMode: " + m).ThrowAsJavaScriptException();
            return false;
        }
    }

    // Forward bandwidthProfile.video sub-options (mode, switch-off, content-preferences, max bitrate).
    if (!requireType(opts, "bandwidthProfile", opts.Get("bandwidthProfile").IsObject(),
                     "bandwidthProfile must be an object")) return false;
    if (opts.Has("bandwidthProfile")) {
        auto bpObj = opts.Get("bandwidthProfile").As<Napi::Object>();
        if (!requireType(bpObj, "video", bpObj.Get("video").IsObject(),
                         "bandwidthProfile.video must be an object")) return false;
        if (bpObj.Has("video")) {
            auto vObj = bpObj.Get("video").As<Napi::Object>();
            twilio::video::VideoBandwidthProfileOptions::Builder vBuilder;

            // Reads a present string enum field. On a wrong type it throws a
            // TypeError and sets *ok false; the caller must abort parsing.
            auto readEnum = [&](const char* field, bool* ok) -> std::string {
                *ok = true;
                if (!vObj.Has(field)) return {};
                Napi::Value value = vObj.Get(field);
                if (!value.IsString()) {
                    Napi::TypeError::New(env, std::string("bandwidthProfile.video.") + field + " must be a string").ThrowAsJavaScriptException();
                    *ok = false;
                    return {};
                }
                return value.As<Napi::String>().Utf8Value();
            };
            bool ok;

            std::string mode = readEnum("mode", &ok);
            if (!ok) return false;
            if (vObj.Has("mode")) {
                if (mode == "collaboration") vBuilder.setMode(twilio::video::BandwidthProfileMode::kCollaboration);
                else if (mode == "grid") vBuilder.setMode(twilio::video::BandwidthProfileMode::kGrid);
                else if (mode == "presentation") vBuilder.setMode(twilio::video::BandwidthProfileMode::kPresentation);
                else {
                    Napi::TypeError::New(env, "Unknown bandwidthProfile.video.mode: " + mode).ThrowAsJavaScriptException();
                    return false;
                }
            }
            if (vObj.Has("maxSubscriptionBitrate")) {
                Napi::Value value = vObj.Get("maxSubscriptionBitrate");
                if (!value.IsNumber()) {
                    Napi::TypeError::New(env, "bandwidthProfile.video.maxSubscriptionBitrate must be a number").ThrowAsJavaScriptException();
                    return false;
                }
                double d = value.As<Napi::Number>().DoubleValue();
                constexpr double kMaxSafe = 9007199254740991.0;
                if (!std::isfinite(d) || d != std::floor(d) || d < 0 || d > kMaxSafe) {
                    Napi::RangeError::New(env, "bandwidthProfile.video.maxSubscriptionBitrate must be a non-negative integer <= Number.MAX_SAFE_INTEGER").ThrowAsJavaScriptException();
                    return false;
                }
                vBuilder.setMaxSubscriptionBitrate(static_cast<uint64_t>(d));
            }
            std::string trackSwitchOffMode = readEnum("trackSwitchOffMode", &ok);
            if (!ok) return false;
            if (vObj.Has("trackSwitchOffMode")) {
                if (trackSwitchOffMode == "detected") vBuilder.setTrackSwitchOffMode(twilio::video::TrackSwitchOffMode::kDetected);
                else if (trackSwitchOffMode == "predicted") vBuilder.setTrackSwitchOffMode(twilio::video::TrackSwitchOffMode::kPredicted);
                else if (trackSwitchOffMode == "disabled") vBuilder.setTrackSwitchOffMode(twilio::video::TrackSwitchOffMode::kDisabled);
                else {
                    Napi::TypeError::New(env, "Unknown trackSwitchOffMode: " + trackSwitchOffMode).ThrowAsJavaScriptException();
                    return false;
                }
            }
            std::string clientControl = readEnum("clientTrackSwitchOffControl", &ok);
            if (!ok) return false;
            if (vObj.Has("clientTrackSwitchOffControl")) {
                if (clientControl == "auto") vBuilder.setClientTrackSwitchOffControl(twilio::video::ClientTrackSwitchOffControl::kAuto);
                else if (clientControl == "manual") vBuilder.setClientTrackSwitchOffControl(twilio::video::ClientTrackSwitchOffControl::kManual);
                else {
                    Napi::TypeError::New(env, "Unknown clientTrackSwitchOffControl: " + clientControl).ThrowAsJavaScriptException();
                    return false;
                }
            }
            std::string contentPrefMode = readEnum("contentPreferencesMode", &ok);
            if (!ok) return false;
            if (vObj.Has("contentPreferencesMode")) {
                if (contentPrefMode == "auto") vBuilder.setContentPreferencesMode(twilio::video::VideoContentPreferencesMode::kAuto);
                else if (contentPrefMode == "manual") vBuilder.setContentPreferencesMode(twilio::video::VideoContentPreferencesMode::kManual);
                else {
                    Napi::TypeError::New(env, "Unknown contentPreferencesMode: " + contentPrefMode).ThrowAsJavaScriptException();
                    return false;
                }
            }
            builder.setBandwidthProfile(twilio::video::BandwidthProfileOptions(vBuilder.build()));
        }
    }

    // Encoding parameters
    if (!requireType(opts, "encodingParameters", opts.Get("encodingParameters").IsObject(),
                     "encodingParameters must be an object")) return false;
    if (opts.Has("encodingParameters")) {
        auto epObj = opts.Get("encodingParameters").As<Napi::Object>();
        twilio::media::EncodingParameters ep;
        constexpr double kMaxSafe = 9007199254740991.0;
        auto readBitrate = [&](const char* field, unsigned long& out) -> bool {
            if (!epObj.Has(field)) return true;
            Napi::Value value = epObj.Get(field);
            if (!value.IsNumber()) {
                Napi::TypeError::New(env, std::string("encodingParameters.") + field + " must be a number").ThrowAsJavaScriptException();
                return false;
            }
            double d = value.As<Napi::Number>().DoubleValue();
            if (!std::isfinite(d) || d != std::floor(d) || d < 0 || d > kMaxSafe) {
                Napi::RangeError::New(env, std::string("encodingParameters.") + field + " must be a non-negative integer <= Number.MAX_SAFE_INTEGER").ThrowAsJavaScriptException();
                return false;
            }
            out = static_cast<unsigned long>(d);
            return true;
        };
        if (!readBitrate("maxAudioBitrate", ep.max_audio_bitrate_)) return false;
        if (!readBitrate("maxVideoBitrate", ep.max_video_bitrate_)) return false;
        builder.setEncodingParameters(ep);
    }

    // ICE options
    if (!requireType(opts, "iceOptions", opts.Get("iceOptions").IsObject(),
                     "iceOptions must be an object")) return false;
    if (opts.Has("iceOptions")) {
        auto iceObj = opts.Get("iceOptions").As<Napi::Object>();
        twilio::media::IceOptions iceOptions;

        if (!requireType(iceObj, "transportPolicy", iceObj.Get("transportPolicy").IsString(),
                         "iceOptions.transportPolicy must be a string")) return false;
        if (iceObj.Has("transportPolicy")) {
            std::string policy = iceObj.Get("transportPolicy").As<Napi::String>().Utf8Value();
            if (policy == "relay") {
                iceOptions.ice_transport_policy = twilio::media::IceTransportPolicy::kIceTransportPolicyRelay;
            } else if (policy == "all") {
                iceOptions.ice_transport_policy = twilio::media::IceTransportPolicy::kIceTransportPolicyAll;
            } else {
                Napi::TypeError::New(env, "Unknown iceOptions.transportPolicy: " + policy).ThrowAsJavaScriptException();
                return false;
            }
        }

        if (!requireType(iceObj, "iceServers", iceObj.Get("iceServers").IsArray(),
                         "iceOptions.iceServers must be an array")) return false;
        if (iceObj.Has("iceServers")) {
            auto servers = iceObj.Get("iceServers").As<Napi::Array>();
            twilio::media::IceServers iceServers;
            for (uint32_t i = 0; i < servers.Length(); i++) {
                if (!servers.Get(i).IsObject()) {
                    Napi::TypeError::New(env, "iceServers entries must be objects").ThrowAsJavaScriptException();
                    return false;
                }
                auto serverObj = servers.Get(i).As<Napi::Object>();
                twilio::media::IceServer server;
                if (serverObj.Has("urls") && serverObj.Get("urls").IsArray()) {
                    auto urls = serverObj.Get("urls").As<Napi::Array>();
                    for (uint32_t j = 0; j < urls.Length(); j++) {
                        auto u = urls.Get(j);
                        if (!u.IsString()) {
                            Napi::TypeError::New(env, "iceServers[].urls entries must be strings").ThrowAsJavaScriptException();
                            return false;
                        }
                        server.urls.push_back(u.As<Napi::String>().Utf8Value());
                    }
                }
                if (serverObj.Has("username")) {
                    auto v = serverObj.Get("username");
                    if (!v.IsString()) {
                        Napi::TypeError::New(env, "iceServers[].username must be a string").ThrowAsJavaScriptException();
                        return false;
                    }
                    server.username = v.As<Napi::String>().Utf8Value();
                }
                if (serverObj.Has("credential")) {
                    auto v = serverObj.Get("credential");
                    if (!v.IsString()) {
                        Napi::TypeError::New(env, "iceServers[].credential must be a string").ThrowAsJavaScriptException();
                        return false;
                    }
                    server.password = v.As<Napi::String>().Utf8Value();
                }
                iceServers.push_back(server);
            }
            iceOptions.ice_servers = iceServers;
        }
        builder.setIceOptions(iceOptions);
    }

    // Platform info (pre-populated by TS layer)
    if (!requireType(opts, "platformInfo", opts.Get("platformInfo").IsObject(),
                     "platformInfo must be an object")) return false;
    if (opts.Has("platformInfo")) {
        auto piObj = opts.Get("platformInfo").As<Napi::Object>();
        twilio::PlatformInfo platformInfo;
        // Reads a present string subfield, rejecting a wrong type with a TypeError.
        auto readPlatformString = [&](const char* field, std::string& out) -> bool {
            if (!piObj.Has(field)) return true;
            Napi::Value value = piObj.Get(field);
            if (!value.IsString()) {
                Napi::TypeError::New(env, std::string("platformInfo.") + field + " must be a string").ThrowAsJavaScriptException();
                return false;
            }
            out = value.As<Napi::String>().Utf8Value();
            return true;
        };
        if (!readPlatformString("sdkVersion", platformInfo.sdkVersion)) return false;
        if (!readPlatformString("platformName", platformInfo.platformName)) return false;
        if (!readPlatformString("platformVersion", platformInfo.platformVersion)) return false;
        if (!readPlatformString("deviceArchitecture", platformInfo.hwDeviceArch)) return false;
        builder.setPlatformInfo(platformInfo);
    }

    // Tracks
    if (!requireType(opts, "videoTracks", opts.Get("videoTracks").IsArray(),
                     "videoTracks must be an array")) return false;
    if (opts.Has("videoTracks")) {
        auto tracks = opts.Get("videoTracks").As<Napi::Array>();
        std::vector<std::shared_ptr<twilio::media::LocalVideoTrack>> videoTracks;
        for (uint32_t i = 0; i < tracks.Length(); i++) {
            auto el = tracks.Get(i);
            if (!el.IsObject() || !LocalVideoTrackWrap::IsInstance(el.As<Napi::Object>())) {
                Napi::TypeError::New(env, "videoTracks entries must be LocalVideoTrack instances").ThrowAsJavaScriptException();
                return false;
            }
            auto* trackWrap = Napi::ObjectWrap<LocalVideoTrackWrap>::Unwrap(el.As<Napi::Object>());
            if (trackWrap) videoTracks.push_back(trackWrap->getTrack());
        }
        builder.setVideoTracks(videoTracks);
    }
    if (!requireType(opts, "audioTracks", opts.Get("audioTracks").IsArray(),
                     "audioTracks must be an array")) return false;
    if (opts.Has("audioTracks")) {
        auto tracks = opts.Get("audioTracks").As<Napi::Array>();
        std::vector<std::shared_ptr<twilio::media::LocalAudioTrack>> audioTracks;
        for (uint32_t i = 0; i < tracks.Length(); i++) {
            auto el = tracks.Get(i);
            if (!el.IsObject() || !LocalAudioTrackWrap::IsInstance(el.As<Napi::Object>())) {
                Napi::TypeError::New(env, "audioTracks entries must be LocalAudioTrack instances").ThrowAsJavaScriptException();
                return false;
            }
            auto* trackWrap = Napi::ObjectWrap<LocalAudioTrackWrap>::Unwrap(el.As<Napi::Object>());
            if (trackWrap) audioTracks.push_back(trackWrap->getTrack());
        }
        builder.setAudioTracks(audioTracks);
    }
    if (!requireType(opts, "dataTracks", opts.Get("dataTracks").IsArray(),
                     "dataTracks must be an array")) return false;
    if (opts.Has("dataTracks")) {
        auto tracks = opts.Get("dataTracks").As<Napi::Array>();
        std::vector<std::shared_ptr<twilio::media::LocalDataTrack>> dataTracks;
        for (uint32_t i = 0; i < tracks.Length(); i++) {
            auto el = tracks.Get(i);
            if (!el.IsObject() || !LocalDataTrackWrap::IsInstance(el.As<Napi::Object>())) {
                Napi::TypeError::New(env, "dataTracks entries must be LocalDataTrack instances").ThrowAsJavaScriptException();
                return false;
            }
            auto* trackWrap = Napi::ObjectWrap<LocalDataTrackWrap>::Unwrap(el.As<Napi::Object>());
            if (trackWrap) dataTracks.push_back(trackWrap->getTrack());
        }
        builder.setDataTracks(dataTracks);
    }

    return true;
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
    roomWrap->asyncContext_ = std::make_shared<AsyncContext>(env, 0);

    std::string token = info[0].As<Napi::String>().Utf8Value();
    twilio::video::ConnectOptions::Builder builder(token);

    // TS layer pre-populates all options; C++ just reads them. Only an absent
    // (undefined) second argument means "no options"; any other present-but-
    // non-object value (including null) is a caller error.
    bool hasOptions = info.Length() >= 2 && !info[1].IsUndefined();
    if (hasOptions && !info[1].IsObject()) {
        Napi::TypeError::New(env, "options must be an object").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    auto opts = hasOptions ? info[1].As<Napi::Object>() : Napi::Object::New(env);

    try {
        // Inside the try so a Napi::Error from an N-API access (e.g. a throwing
        // property getter on the options object) surfaces as a JS exception
        // rather than escaping the N-API callback and aborting the process.
        if (!parseConnectOptions(env, opts, builder)) return env.Undefined();

        auto connectOptions = builder.build();
        std::shared_ptr<twilio::video::RoomObserver> observer =
            std::static_pointer_cast<twilio::video::RoomObserver>(roomWrap->observer_);
        roomWrap->room_ = twilio::video::connect(connectOptions, observer);
    } catch (const Napi::Error& e) {
        // Re-surface the already-constructed JS error (carries its original value).
        // Caught before std::exception because Napi::Error derives from it.
        e.ThrowAsJavaScriptException();
        return env.Undefined();
    } catch (const std::exception& e) {
        // Use Error, not TypeError: bad arguments are already rejected with TypeError
        // in parseConnectOptions, so anything reaching here is a runtime failure.
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Undefined();
    }

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
    statsObservers_->cancelAll();

    // Close observer before disconnect to prevent callbacks during teardown
    if (observer_) {
        observer_->close();
    }

    if (room_) {
        room_->disconnect();
    }

    if (asyncContext_) {
        asyncContext_->close();
    }
    eventCallback_.Reset();
    localParticipantCache_.Reset();
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
    if (eventCallback_.IsEmpty()) return;
    Napi::Env env = eventCallback_.Value().Env();
    if (arg.IsEmpty() || arg.IsUndefined()) {
        eventCallback_.Call({Napi::String::New(env, eventName)});
    } else {
        eventCallback_.Call({Napi::String::New(env, eventName), arg});
    }
}

void RoomWrap::ForgetParticipantWrap(const std::string& sid) {
    participantCache_.erase(sid);
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

    if (!localParticipantCache_.IsEmpty()) {
        return localParticipantCache_.Value();
    }

    auto obj = LocalParticipantWrap::NewInstance(info.Env(), participant);
    localParticipantCache_ = Napi::Persistent(obj);
    return obj;
}

Napi::Value RoomWrap::GetDominantSpeaker(const Napi::CallbackInfo& info) {
    if (!room_) return info.Env().Null();

    auto participant = room_->getDominantSpeaker();
    if (!participant) return info.Env().Null();

    // Reuse whichever observer this participant already has rather than
    // installing a new one, which would silently stop event delivery to
    // whichever JS wrap the existing observer is bound to.
    auto observer = observer_ ? observer_->GetOrCreateParticipantObserver(participant) : nullptr;
    return RemoteParticipantWrap::NewInstance(info.Env(), participant, observer);
}

Napi::Value RoomWrap::GetRemoteParticipants(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!room_) return Napi::Array::New(env, 0);

    auto participants = room_->getRemoteParticipants();
    auto array = Napi::Array::New(env, participants.size());

    uint32_t i = 0;
    for (const auto& pair : participants) {
        const std::string& sid = pair.first;

        auto cacheIt = participantCache_.find(sid);
        if (cacheIt != participantCache_.end() && !cacheIt->second.IsEmpty()) {
            array.Set(i++, cacheIt->second.Value());
        } else {
            // Reuse whichever observer this participant already has (from
            // onParticipantConnected, or a prior access here) rather than
            // installing a new one, which would silently stop event delivery to
            // whichever JS wrap the existing observer is bound to.
            auto observer = observer_ ? observer_->GetOrCreateParticipantObserver(pair.second) : nullptr;
            auto participantObj = RemoteParticipantWrap::NewInstance(env, pair.second, observer);
            participantCache_[sid] = Napi::Persistent(participantObj);
            array.Set(i++, participantObj);
        }
    }

    // Departed participants are dropped by ForgetParticipantWrap when their
    // disconnect is delivered, not by pruning whoever is missing from this
    // read. The SDK removes a participant before it raises that event, so a
    // read landing in between would evict an entry that is still needed, which
    // is the same rule Room's own participant cache follows in JS.
    return array;
}

Napi::Value RoomWrap::Disconnect(const Napi::CallbackInfo& info) {
    if (room_) {
        room_->disconnect();
    }
    return info.Env().Undefined();
}

Napi::Value RoomWrap::Dispose(const Napi::CallbackInfo& info) {
    statsObservers_->cancelAll();

    // Close observer before disconnect to prevent callbacks during teardown
    if (observer_) {
        observer_->close();
        observer_.reset();
    }

    if (room_) {
        room_->disconnect();
    }
    eventCallback_.Reset();
    localParticipantCache_.Reset();
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

Napi::Value RoomWrap::SetEventCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Expected callback function").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    eventCallback_ = Napi::Persistent(info[0].As<Napi::Function>());
    return env.Undefined();
}

static Napi::Object convertDimensions(Napi::Env env, const twilio::media::VideoDimensions& dims) {
    auto obj = Napi::Object::New(env);
    obj.Set("width", dims.width);
    obj.Set("height", dims.height);
    return obj;
}

template <typename T>
static void setBaseTrackStats(Napi::Env env, Napi::Object& obj, const T& s) {
    obj.Set("codec", Napi::String::New(env, s.codec));
    obj.Set("packetsLost", Napi::Number::New(env, s.packets_lost));
    obj.Set("ssrc", Napi::String::New(env, s.ssrc));
    obj.Set("timestamp", Napi::Number::New(env, s.timestamp));
    obj.Set("trackSid", Napi::String::New(env, s.track_sid));
}

template <typename T>
static void setLocalTrackStats(Napi::Env env, Napi::Object& obj, const T& s) {
    setBaseTrackStats(env, obj, s);
    obj.Set("bytesSent", Napi::Number::New(env, static_cast<double>(s.bytes_sent)));
    obj.Set("packetsSent", Napi::Number::New(env, s.packets_sent));
    obj.Set("roundTripTime", Napi::Number::New(env, static_cast<double>(s.round_trip_time)));
}

template <typename T>
static void setRemoteTrackStats(Napi::Env env, Napi::Object& obj, const T& s) {
    setBaseTrackStats(env, obj, s);
    obj.Set("bytesReceived", Napi::Number::New(env, static_cast<double>(s.bytes_received)));
    obj.Set("packetsReceived", Napi::Number::New(env, s.packets_received));
}

static Napi::Value convertStatsReportsToJS(Napi::Env env,
    const std::vector<twilio::media::StatsReport>& reports) {
    auto jsArray = Napi::Array::New(env, reports.size());

    for (uint32_t i = 0; i < reports.size(); i++) {
        const auto& report = reports[i];
        auto obj = Napi::Object::New(env);
        obj.Set("peerConnectionId", Napi::String::New(env, report.peer_connection_id));

        auto laStats = Napi::Array::New(env, report.local_audio_track_stats.size());
        for (uint32_t j = 0; j < report.local_audio_track_stats.size(); j++) {
            auto o = Napi::Object::New(env);
            const auto& s = report.local_audio_track_stats[j];
            setLocalTrackStats(env, o, s);
            o.Set("audioLevel", Napi::Number::New(env, s.audio_level));
            o.Set("jitter", Napi::Number::New(env, s.jitter));
            laStats.Set(j, o);
        }
        obj.Set("localAudioTrackStats", laStats);

        auto lvStats = Napi::Array::New(env, report.local_video_track_stats.size());
        for (uint32_t j = 0; j < report.local_video_track_stats.size(); j++) {
            auto o = Napi::Object::New(env);
            const auto& s = report.local_video_track_stats[j];
            setLocalTrackStats(env, o, s);
            o.Set("captureDimensions", convertDimensions(env, s.capture_dimensions));
            o.Set("dimensions", convertDimensions(env, s.dimensions));
            o.Set("captureFrameRate", Napi::Number::New(env, s.capture_frame_rate));
            o.Set("frameRate", Napi::Number::New(env, s.frame_rate));
            o.Set("framesEncoded", Napi::Number::New(env, s.frames_encoded));
            lvStats.Set(j, o);
        }
        obj.Set("localVideoTrackStats", lvStats);

        auto raStats = Napi::Array::New(env, report.remote_audio_track_stats.size());
        for (uint32_t j = 0; j < report.remote_audio_track_stats.size(); j++) {
            auto o = Napi::Object::New(env);
            const auto& s = report.remote_audio_track_stats[j];
            setRemoteTrackStats(env, o, s);
            o.Set("audioLevel", Napi::Number::New(env, s.audio_level));
            o.Set("jitter", Napi::Number::New(env, s.jitter));
            raStats.Set(j, o);
        }
        obj.Set("remoteAudioTrackStats", raStats);

        auto rvStats = Napi::Array::New(env, report.remote_video_track_stats.size());
        for (uint32_t j = 0; j < report.remote_video_track_stats.size(); j++) {
            auto o = Napi::Object::New(env);
            const auto& s = report.remote_video_track_stats[j];
            setRemoteTrackStats(env, o, s);
            o.Set("dimensions", convertDimensions(env, s.dimensions));
            o.Set("frameRate", Napi::Number::New(env, s.frame_rate));
            rvStats.Set(j, o);
        }
        obj.Set("remoteVideoTrackStats", rvStats);

        jsArray.Set(i, obj);
    }

    return jsArray;
}

void StatsObserverRegistry::add(
    const std::shared_ptr<OneShotStatsObserver>& obs) {
    std::lock_guard<std::mutex> lock(mutex_);
    observers_.insert(obs);
}

void StatsObserverRegistry::remove(
    const std::shared_ptr<OneShotStatsObserver>& obs) {
    std::lock_guard<std::mutex> lock(mutex_);
    observers_.erase(obs);
}

void StatsObserverRegistry::cancelAll() {
    // Cancel outside the lock so dispatch work doesn't block onStats()'s remove().
    std::set<std::shared_ptr<OneShotStatsObserver>> pending;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        pending.swap(observers_);
    }
    for (auto& obs : pending) {
        obs->cancel();
    }
}

OneShotStatsObserver::OneShotStatsObserver(
    std::shared_ptr<AsyncContext> ctx,
    std::shared_ptr<Napi::FunctionReference> cb,
    std::weak_ptr<StatsObserverRegistry> registry)
    : asyncContext_(std::move(ctx)),
      callback_(std::move(cb)),
      registry_(std::move(registry)) {}

OneShotStatsObserver::~OneShotStatsObserver() {
    // cancel() or onStats() must have moved callback_ away before destruction.
    // If this fires, a code path is missing cleanup.
    assert(!callback_ && "OneShotStatsObserver destroyed with live callback");
}

void OneShotStatsObserver::onStats(
    const std::vector<twilio::media::StatsReport>& stats_reports) {
    if (fired_.exchange(true)) return;

    auto reports = stats_reports;
    auto cb = std::move(callback_);
    auto ctx = asyncContext_;

    if (ctx && !ctx->isClosed()) {
        ctx->dispatch([reports = std::move(reports), cb](Napi::Env env) {
            if (!cb || cb->IsEmpty()) return;
            Napi::HandleScope scope(env);
            auto jsReports = convertStatsReportsToJS(env, reports);
            cb->Call({env.Null(), jsReports});
        });
    }

    // Drop ourselves from the pending set last: rtc-cpp invokes onStats through
    // a locked weak_ptr, so `this` stays alive until we return even after the
    // registry releases its shared_ptr. Skipped when the room is being torn
    // down (registry already gone / cancelAll clearing the set).
    if (auto registry = registry_.lock()) {
        registry->remove(shared_from_this());
    }
}

void OneShotStatsObserver::cancel() {
    // Called only from StatsObserverRegistry::cancelAll during teardown; the
    // fired_ guard makes it mutually exclusive with onStats().
    if (fired_.exchange(true)) return;

    auto cb = std::move(callback_);
    auto ctx = asyncContext_;

    if (!ctx || ctx->isClosed()) return;

    ctx->dispatch([cb](Napi::Env env) {
        if (!cb || cb->IsEmpty()) return;
        cb->Call({Napi::Error::New(env, "Room was disconnected").Value()});
    });
}

Napi::Value RoomWrap::GetStats(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Expected callback function").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto callback = std::make_shared<Napi::FunctionReference>(
        Napi::Persistent(info[0].As<Napi::Function>()));

    if (!room_) {
        if (asyncContext_ && !asyncContext_->isClosed()) {
            asyncContext_->dispatch([callback](Napi::Env env) {
                callback->Call({Napi::Error::New(env, "Room is not connected").Value()});
            });
        } else {
            callback->Call({Napi::Error::New(env, "Room is not connected").Value()});
        }
        return env.Undefined();
    }

    // rtc-cpp silently drops getStats when not connected/reconnecting
    auto state = room_->getState();
    if (state != twilio::video::Room::State::kConnected &&
        state != twilio::video::Room::State::kReconnecting) {
        if (asyncContext_ && !asyncContext_->isClosed()) {
            asyncContext_->dispatch([callback](Napi::Env env) {
                callback->Call({Napi::Error::New(env, "Room is not connected").Value()});
            });
        } else {
            callback->Call({Napi::Error::New(env, "Room is not connected").Value()});
        }
        return env.Undefined();
    }

    auto observer = std::make_shared<OneShotStatsObserver>(
        asyncContext_, callback, statsObservers_);

    statsObservers_->add(observer);

    room_->getStats(observer);

    return env.Undefined();
}

}
