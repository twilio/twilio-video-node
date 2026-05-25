#pragma once

#include <napi.h>
#include <webrtc/api/media_stream_interface.h>
#include "../common/async_context.h"
#include <mutex>
#include <atomic>
#include <vector>

namespace twilio_video_node {

struct AudioFrameData {
    std::vector<int16_t> samples;
    int bitsPerSample;
    int sampleRate;
    size_t numberOfChannels;
    size_t numberOfFrames;
    int64_t timestampUs;
    uint32_t frameId;
};

class AudioFrameSink : public webrtc::AudioTrackSinkInterface {
public:
    AudioFrameSink(Napi::Env env, Napi::Function callback);
    ~AudioFrameSink();

    void OnData(const void* audio_data,
                int bits_per_sample,
                int sample_rate,
                size_t number_of_channels,
                size_t number_of_frames) override;

    void close();

private:
    void deliverFrame(AudioFrameData frameData);

    Napi::Env env_;
    Napi::FunctionReference callback_;
    std::unique_ptr<AsyncContext> asyncContext_;
    std::atomic<bool> closed_{false};
    std::mutex mutex_;
    std::atomic<uint32_t> nextFrameId_{0};
};

}
