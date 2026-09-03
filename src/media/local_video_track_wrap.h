#pragma once

#include <napi.h>
#include <twilio/media/media_factory.h>
#include <twilio/media/track.h>
#include <twilio/media/video_track_options.h>
#include <webrtc/api/video/video_source_interface.h>
#include <webrtc/media/base/adapted_video_track_source.h>
#include <webrtc/api/video/i420_buffer.h>
#include <webrtc/rtc_base/timestamp_aligner.h>
#include <webrtc/rtc_base/time_utils.h>

namespace twilio_video_node {

class PushableVideoSource : public rtc::AdaptedVideoTrackSource {
public:
    PushableVideoSource() = default;
    ~PushableVideoSource() override = default;

    // Returns true if the frame was forwarded to the encoder sink; false if
    // dropped by the adapter (e.g. before the encoder sink attaches after
    // peer-connection negotiation).
    bool PushFrame(rtc::scoped_refptr<webrtc::I420Buffer> buffer,
                   int64_t timestampUs,
                   webrtc::VideoRotation rotation);

    SourceState state() const override { return kLive; }
    bool remote() const override { return false; }
    bool is_screencast() const override { return false; }
    absl::optional<bool> needs_denoising() const override { return false; }

private:
    rtc::TimestampAligner timestamp_aligner_;
    int64_t next_timestamp_us_ = rtc::kNumMicrosecsPerMillisec;
};

class LocalVideoTrackWrap : public Napi::ObjectWrap<LocalVideoTrackWrap> {
public:
    static void Init(Napi::Env env, Napi::Object exports);
    static Napi::Object NewInstance(Napi::Env env,
                                    std::shared_ptr<twilio::media::MediaFactory> factory,
                                    const twilio::media::VideoTrackOptions& options);
    static bool IsInstance(Napi::Object obj);

    LocalVideoTrackWrap(const Napi::CallbackInfo& info);
    ~LocalVideoTrackWrap();

    std::shared_ptr<twilio::media::LocalVideoTrack> getTrack() const { return track_; }
    std::shared_ptr<twilio::media::MediaFactory> getFactory() const { return factory_; }

private:
    static Napi::FunctionReference constructor_;

    Napi::Value GetName(const Napi::CallbackInfo& info);
    Napi::Value GetKind(const Napi::CallbackInfo& info);
    Napi::Value IsEnabled(const Napi::CallbackInfo& info);
    void SetEnabled(const Napi::CallbackInfo& info, const Napi::Value& value);
    Napi::Value Write(const Napi::CallbackInfo& info);
    Napi::Value GetWriteStats(const Napi::CallbackInfo& info);
    Napi::Value ConfigureSource(const Napi::CallbackInfo& info);

    std::shared_ptr<twilio::media::LocalVideoTrack> track_;
    std::shared_ptr<twilio::media::MediaFactory> factory_;
    rtc::scoped_refptr<PushableVideoSource> videoSource_;

    // Publish-side counters backing getWriteStats(). Video publish is
    // synchronous (write == send), so there is no SDK-side send queue and
    // sendQueueDepth is always 0; a drop here means the frame was rejected by
    // libwebrtc's adapter, not shed from a queue.
    // Set from CreateLocalVideoTrackOptions.source. When present, write()
    // rejects frames whose dimensions disagree, so a mismatch surfaces at the
    // call site instead of as a silently rescaled stream.
    int32_t expectedWidth_{0};
    int32_t expectedHeight_{0};

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
