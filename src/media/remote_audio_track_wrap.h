#pragma once

#include <napi.h>
#include <twilio/media/track.h>
#include "../sinks/audio_frame_sink.h"

namespace twilio_video_node {

class RemoteAudioTrackWrap : public Napi::ObjectWrap<RemoteAudioTrackWrap> {
public:
    static void Init(Napi::Env env, Napi::Object exports);
    static Napi::Object NewInstance(Napi::Env env, std::shared_ptr<twilio::media::RemoteAudioTrack> track);

    RemoteAudioTrackWrap(const Napi::CallbackInfo& info);
    ~RemoteAudioTrackWrap();

    std::shared_ptr<twilio::media::RemoteAudioTrack> getTrack() const { return track_; }

private:
    static Napi::FunctionReference constructor_;

    Napi::Value GetName(const Napi::CallbackInfo& info);
    Napi::Value GetKind(const Napi::CallbackInfo& info);
    Napi::Value GetSid(const Napi::CallbackInfo& info);
    Napi::Value IsEnabled(const Napi::CallbackInfo& info);
    Napi::Value OnData(const Napi::CallbackInfo& info);
    Napi::Value RemoveDataCallback(const Napi::CallbackInfo& info);

    std::shared_ptr<twilio::media::RemoteAudioTrack> track_;
    std::unique_ptr<AudioFrameSink> audioSink_;
};

}
