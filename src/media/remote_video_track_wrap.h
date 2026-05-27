#pragma once

#include <napi.h>
#include <twilio/media/track.h>
#include "../sinks/video_frame_sink.h"

namespace twilio_video_node {

class RemoteVideoTrackWrap : public Napi::ObjectWrap<RemoteVideoTrackWrap> {
public:
    static void Init(Napi::Env env, Napi::Object exports);
    static Napi::Object NewInstance(Napi::Env env, std::shared_ptr<twilio::media::RemoteVideoTrack> track);

    RemoteVideoTrackWrap(const Napi::CallbackInfo& info);
    ~RemoteVideoTrackWrap();

    std::shared_ptr<twilio::media::RemoteVideoTrack> getTrack() const { return track_; }

private:
    static Napi::FunctionReference constructor_;

    Napi::Value GetName(const Napi::CallbackInfo& info);
    Napi::Value GetKind(const Napi::CallbackInfo& info);
    Napi::Value GetSid(const Napi::CallbackInfo& info);
    Napi::Value IsEnabled(const Napi::CallbackInfo& info);
    Napi::Value IsSwitchedOff(const Napi::CallbackInfo& info);
    Napi::Value OnFrame(const Napi::CallbackInfo& info);
    Napi::Value RemoveFrameCallback(const Napi::CallbackInfo& info);
    Napi::Value SetContentPreferences(const Napi::CallbackInfo& info);

    std::shared_ptr<twilio::media::RemoteVideoTrack> track_;
    std::unique_ptr<VideoFrameSink> frameSink_;
};

}
