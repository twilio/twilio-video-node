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

#ifdef __APPLE__
#include <CoreFoundation/CoreFoundation.h>
#endif

namespace twilio_video_node {

Napi::String GetVersion(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), twilio::video::getVersion());
}

#ifdef __APPLE__
Napi::Value PumpMainQueue(const Napi::CallbackInfo& info) {
    // Process pending work on the main dispatch queue
    // rtc-cpp posts observer callbacks to dispatch_get_main_queue()
    // Node.js doesn't pump this queue, so we do it manually
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.001, true);
    return info.Env().Undefined();
}
#endif

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    printf("[C++] Module Init() called\n");
    fflush(stdout);
    exports.Set("getVersion", Napi::Function::New(env, GetVersion));
#ifdef __APPLE__
    exports.Set("pumpMainQueue", Napi::Function::New(env, PumpMainQueue));
#endif

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
