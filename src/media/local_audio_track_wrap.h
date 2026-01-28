#pragma once

#include <napi.h>
#include <twilio/media/media_factory.h>
#include <twilio/media/track.h>
#include <twilio/media/audio_track_options.h>

namespace twilio_video_node {

class LocalAudioTrackWrap : public Napi::ObjectWrap<LocalAudioTrackWrap> {
public:
    static void Init(Napi::Env env, Napi::Object exports);
    static Napi::Object NewInstance(Napi::Env env,
                                    std::shared_ptr<twilio::media::MediaFactory> factory,
                                    const twilio::media::AudioTrackOptions& options);

    LocalAudioTrackWrap(const Napi::CallbackInfo& info);
    ~LocalAudioTrackWrap();

    std::shared_ptr<twilio::media::LocalAudioTrack> getTrack() const { return track_; }
    std::shared_ptr<twilio::media::MediaFactory> getFactory() const { return factory_; }

private:
    static Napi::FunctionReference constructor_;

    Napi::Value GetName(const Napi::CallbackInfo& info);
    Napi::Value IsEnabled(const Napi::CallbackInfo& info);
    void SetEnabled(const Napi::CallbackInfo& info, const Napi::Value& value);

    std::shared_ptr<twilio::media::LocalAudioTrack> track_;
    std::shared_ptr<twilio::media::MediaFactory> factory_;
};

}
