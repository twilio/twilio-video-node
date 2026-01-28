#pragma once

#include <napi.h>
#include <twilio/media/media_factory.h>
#include <twilio/media/track.h>
#include <twilio/media/video_track_options.h>
#include <webrtc/api/video/video_source_interface.h>
#include <webrtc/media/base/adapted_video_track_source.h>
#include <webrtc/api/video/i420_buffer.h>

namespace twilio_video_node {

class PushableVideoSource : public rtc::AdaptedVideoTrackSource {
public:
    PushableVideoSource() = default;
    ~PushableVideoSource() override = default;

    void PushFrame(rtc::scoped_refptr<webrtc::I420Buffer> buffer, int64_t timestampUs);

    SourceState state() const override { return kLive; }
    bool remote() const override { return false; }
    bool is_screencast() const override { return false; }
    absl::optional<bool> needs_denoising() const override { return false; }
};

class LocalVideoTrackWrap : public Napi::ObjectWrap<LocalVideoTrackWrap> {
public:
    static void Init(Napi::Env env, Napi::Object exports);
    static Napi::Object NewInstance(Napi::Env env,
                                    std::shared_ptr<twilio::media::MediaFactory> factory,
                                    const twilio::media::VideoTrackOptions& options);

    LocalVideoTrackWrap(const Napi::CallbackInfo& info);
    ~LocalVideoTrackWrap();

    std::shared_ptr<twilio::media::LocalVideoTrack> getTrack() const { return track_; }
    std::shared_ptr<twilio::media::MediaFactory> getFactory() const { return factory_; }

private:
    static Napi::FunctionReference constructor_;

    Napi::Value GetName(const Napi::CallbackInfo& info);
    Napi::Value IsEnabled(const Napi::CallbackInfo& info);
    void SetEnabled(const Napi::CallbackInfo& info, const Napi::Value& value);
    Napi::Value PushFrame(const Napi::CallbackInfo& info);

    std::shared_ptr<twilio::media::LocalVideoTrack> track_;
    std::shared_ptr<twilio::media::MediaFactory> factory_;
    rtc::scoped_refptr<PushableVideoSource> videoSource_;
};

}
