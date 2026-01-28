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

namespace twilio_video_node {

Napi::String GetVersion(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), twilio::video::getVersion());
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("getVersion", Napi::Function::New(env, GetVersion));

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
