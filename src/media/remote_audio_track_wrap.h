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
    // Internal plumbing for the JS frames() iterator in lib/. Not public API:
    // lib/remote_track.ts owns the policy queue and exposes frames()/getStats().
    Napi::Value AttachFrameSink(const Napi::CallbackInfo& info);
    Napi::Value DetachFrameSink(const Napi::CallbackInfo& info);
    Napi::Value SinkStats(const Napi::CallbackInfo& info);

    void detachSink();

    std::shared_ptr<twilio::media::RemoteAudioTrack> track_;
    std::unique_ptr<AudioFrameSink> audioSink_;
};

}
