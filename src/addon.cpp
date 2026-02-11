#include <napi.h>
#include "video/room_wrap.h"
#include "video/connect_options_wrap.h"
#include "video/local_participant_wrap.h"
#include "video/remote_participant_wrap.h"
#include "media/media_factory_wrap.h"
#include "media/local_video_track_wrap.h"
#include "media/local_audio_track_wrap.h"
#include "media/local_data_track_wrap.h"
#include "media/remote_video_track_wrap.h"
#include "media/remote_audio_track_wrap.h"
#include "media/remote_data_track_wrap.h"

#include <twilio/video/video.h>
#include <twilio/log.h>

namespace twilio_video_node {

Napi::String GetVersion(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), twilio::video::getVersion());
}

void SetLogLevel(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected log level argument").ThrowAsJavaScriptException();
        return;
    }

    twilio::LogLevel level;
    if (info[0].IsNumber()) {
        level = static_cast<twilio::LogLevel>(info[0].As<Napi::Number>().Int32Value());
    } else if (info[0].IsString()) {
        std::string s = info[0].As<Napi::String>().Utf8Value();
        if (s == "off") level = twilio::LogLevel::kOff;
        else if (s == "fatal") level = twilio::LogLevel::kFatal;
        else if (s == "error") level = twilio::LogLevel::kError;
        else if (s == "warning") level = twilio::LogLevel::kWarning;
        else if (s == "info") level = twilio::LogLevel::kInfo;
        else if (s == "debug") level = twilio::LogLevel::kDebug;
        else if (s == "trace") level = twilio::LogLevel::kTrace;
        else if (s == "all") level = twilio::LogLevel::kAll;
        else {
            Napi::TypeError::New(env, "Invalid log level: " + s).ThrowAsJavaScriptException();
            return;
        }
    } else {
        Napi::TypeError::New(env, "Expected string or number").ThrowAsJavaScriptException();
        return;
    }

    twilio::setLogLevel(level);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("getVersion", Napi::Function::New(env, GetVersion));
    exports.Set("setLogLevel", Napi::Function::New(env, SetLogLevel));

    MediaFactoryWrap::Init(env, exports);
    ConnectOptionsWrap::Init(env, exports);
    RoomWrap::Init(env, exports);
    LocalParticipantWrap::Init(env, exports);
    RemoteParticipantWrap::Init(env, exports);
    LocalVideoTrackWrap::Init(env, exports);
    LocalAudioTrackWrap::Init(env, exports);
    LocalDataTrackWrap::Init(env, exports);
    RemoteVideoTrackWrap::Init(env, exports);
    RemoteAudioTrackWrap::Init(env, exports);
    RemoteDataTrackWrap::Init(env, exports);

    return exports;
}

NODE_API_MODULE(twilio_video_sdk_node, Init)

}
