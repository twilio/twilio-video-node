#include "audio_frame_sink.h"
#include <chrono>

namespace twilio_video_node {

AudioFrameSink::AudioFrameSink(Napi::Env env, Napi::Function callback)
    : env_(env)
    , callback_(Napi::Persistent(callback))
    , asyncContext_(std::make_unique<AsyncContext>(env)) {
}

AudioFrameSink::~AudioFrameSink() {
    close();
}

void AudioFrameSink::close() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (closed_) return;
    closed_ = true;
    if (asyncContext_) {
        asyncContext_->close();
        asyncContext_.reset();
    }
    callback_.Reset();
}

void AudioFrameSink::OnData(const void* audio_data,
                            int bits_per_sample,
                            int sample_rate,
                            size_t number_of_channels,
                            size_t number_of_frames) {
    if (closed_) return;

    try {
        AudioFrameData frameData;
        frameData.bitsPerSample = bits_per_sample;
        frameData.sampleRate = sample_rate;
        frameData.numberOfChannels = number_of_channels;
        frameData.numberOfFrames = number_of_frames;
        frameData.frameId = nextFrameId_.fetch_add(1);

        auto now = std::chrono::high_resolution_clock::now();
        frameData.timestampUs = std::chrono::duration_cast<std::chrono::microseconds>(
            now.time_since_epoch()).count();

        size_t sampleCount = number_of_frames * number_of_channels;
        frameData.samples.resize(sampleCount);

        if (bits_per_sample == 16) {
            const int16_t* src = static_cast<const int16_t*>(audio_data);
            memcpy(frameData.samples.data(), src, sampleCount * sizeof(int16_t));
        } else {
            memset(frameData.samples.data(), 0, sampleCount * sizeof(int16_t));
        }

        deliverFrame(std::move(frameData));
    } catch (...) {
        // Swallow exceptions on WebRTC callback thread to prevent crash
    }
}

void AudioFrameSink::deliverFrame(AudioFrameData frameData) {
    if (closed_ || !asyncContext_) return;

    asyncContext_->dispatch([this, frameData = std::move(frameData)](Napi::Env env) {
        if (closed_ || callback_.IsEmpty()) return;

        Napi::HandleScope scope(env);

        auto pcmBuffer = Napi::Buffer<int16_t>::Copy(env, frameData.samples.data(), frameData.samples.size());

        auto audioFrame = Napi::Object::New(env);
        audioFrame.Set("format", Napi::String::New(env, "PCM_S16LE"));
        audioFrame.Set("sampleRate", Napi::Number::New(env, frameData.sampleRate));
        audioFrame.Set("channels", Napi::Number::New(env, static_cast<uint32_t>(frameData.numberOfChannels)));
        audioFrame.Set("frames", Napi::Number::New(env, static_cast<uint32_t>(frameData.numberOfFrames)));
        audioFrame.Set("pcm", pcmBuffer);
        audioFrame.Set("timestampNs", Napi::BigInt::New(env, frameData.timestampUs * 1000));
        audioFrame.Set("frameId", Napi::Number::New(env, frameData.frameId));

        callback_.Call({audioFrame});
    });
}

}
