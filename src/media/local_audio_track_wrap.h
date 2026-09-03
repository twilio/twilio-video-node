#pragma once

#include <napi.h>
#include <twilio/media/media_factory.h>
#include <twilio/media/track.h>
#include <twilio/media/audio_track_options.h>
#include <webrtc/api/media_stream_interface.h>
#include <webrtc/api/notifier.h>
#include <webrtc/api/scoped_refptr.h>
#include <webrtc/rtc_base/time_utils.h>
#include <list>
#include <mutex>
#include "node_audio_device.h"

namespace twilio_video_node {

class PushableAudioSource : public webrtc::Notifier<webrtc::AudioSourceInterface>,
                            public webrtc::AudioTrackSinkInterface {
public:
    explicit PushableAudioSource(rtc::scoped_refptr<NodeAudioDevice> adm);
    ~PushableAudioSource() override = default;

    // Returns false when the bounded publish queue shed samples to make room.
    bool PushSamples(const int16_t* data, int bits_per_sample,
                     int sample_rate, size_t number_of_channels,
                     size_t number_of_frames);

    void ClearBuffer();
    NodeAudioDevice* adm() const { return adm_.get(); }

    // AudioSourceInterface
    SourceState state() const override { return kLive; }
    bool remote() const override { return false; }
    void AddSink(webrtc::AudioTrackSinkInterface* sink) override;
    void RemoveSink(webrtc::AudioTrackSinkInterface* sink) override;

    // AudioTrackSinkInterface
    void OnData(const void* audio_data, int bits_per_sample,
                int sample_rate, size_t number_of_channels,
                size_t number_of_frames) override;

private:
    rtc::scoped_refptr<NodeAudioDevice> adm_;
    std::mutex sink_lock_;
    std::list<webrtc::AudioTrackSinkInterface*> sinks_;
};

class LocalAudioTrackWrap : public Napi::ObjectWrap<LocalAudioTrackWrap> {
public:
    static void Init(Napi::Env env, Napi::Object exports);
    static Napi::Object NewInstance(Napi::Env env,
                                    std::shared_ptr<twilio::media::MediaFactory> factory,
                                    const twilio::media::AudioTrackOptions& options,
                                    rtc::scoped_refptr<NodeAudioDevice> adm);
    static bool IsInstance(Napi::Object obj);

    LocalAudioTrackWrap(const Napi::CallbackInfo& info);
    ~LocalAudioTrackWrap();

    std::shared_ptr<twilio::media::LocalAudioTrack> getTrack() const { return track_; }
    std::shared_ptr<twilio::media::MediaFactory> getFactory() const { return factory_; }

private:
    static Napi::FunctionReference constructor_;

    Napi::Value GetName(const Napi::CallbackInfo& info);
    Napi::Value GetKind(const Napi::CallbackInfo& info);
    Napi::Value IsEnabled(const Napi::CallbackInfo& info);
    void SetEnabled(const Napi::CallbackInfo& info, const Napi::Value& value);
    Napi::Value Write(const Napi::CallbackInfo& info);
    Napi::Value ClearBuffer(const Napi::CallbackInfo& info);
    Napi::Value GetWriteStats(const Napi::CallbackInfo& info);
    Napi::Value ConfigureSource(const Napi::CallbackInfo& info);

    std::shared_ptr<twilio::media::LocalAudioTrack> track_;
    std::shared_ptr<twilio::media::MediaFactory> factory_;
    rtc::scoped_refptr<PushableAudioSource> audioSource_;

    uint64_t framesWritten_{0};
    uint64_t framesDropped_{0};
    bool hasLastTimestamp_{false};
    int64_t lastTimestampUs_{0};
    // A timestamp that does not advance is accepted and counted rather than
    // rejected: a legitimate producer can restart a loop, and silently
    // reordering or dropping would be worse than making it visible.
    uint64_t timestampRegressions_{0};
};

}
