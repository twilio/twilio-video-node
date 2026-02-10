#include "local_audio_track_wrap.h"
#include <webrtc/rtc_base/ref_counted_object.h>

namespace twilio_video_node {

// --- PushableAudioSource ---

void PushableAudioSource::AddSink(webrtc::AudioTrackSinkInterface* sink) {
    std::lock_guard<std::mutex> lock(sink_lock_);
    sinks_.push_back(sink);
}

void PushableAudioSource::RemoveSink(webrtc::AudioTrackSinkInterface* sink) {
    std::lock_guard<std::mutex> lock(sink_lock_);
    sinks_.remove(sink);
}

void PushableAudioSource::OnData(const void* audio_data, int bits_per_sample,
                                  int sample_rate, size_t number_of_channels,
                                  size_t number_of_frames) {
    PushSamples(static_cast<const int16_t*>(audio_data),
                bits_per_sample, sample_rate, number_of_channels, number_of_frames);
}

void PushableAudioSource::PushSamples(const int16_t* data, int bits_per_sample,
                                       int sample_rate, size_t number_of_channels,
                                       size_t number_of_frames) {
    int64_t capture_timestamp_ms = rtc::TimeMillis();
    std::lock_guard<std::mutex> lock(sink_lock_);
    for (auto* sink : sinks_) {
        sink->OnData(data, bits_per_sample, sample_rate,
                     number_of_channels, number_of_frames,
                     capture_timestamp_ms);
    }
}

// --- LocalAudioTrackWrap ---

Napi::FunctionReference LocalAudioTrackWrap::constructor_;

bool LocalAudioTrackWrap::IsInstance(Napi::Object obj) {
    return obj.InstanceOf(constructor_.Value());
}

void LocalAudioTrackWrap::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "LocalAudioTrack", {
        InstanceAccessor("name", &LocalAudioTrackWrap::GetName, nullptr),
        InstanceAccessor("enabled", &LocalAudioTrackWrap::IsEnabled, &LocalAudioTrackWrap::SetEnabled),
        InstanceMethod("pushSamples", &LocalAudioTrackWrap::PushSamples),
    });

    constructor_ = Napi::Persistent(func);
    constructor_.SuppressDestruct();
    exports.Set("LocalAudioTrack", func);
}

Napi::Object LocalAudioTrackWrap::NewInstance(Napi::Env env,
                                               std::shared_ptr<twilio::media::MediaFactory> factory,
                                               const twilio::media::AudioTrackOptions& options) {
    Napi::EscapableHandleScope scope(env);

    auto source = rtc::make_ref_counted<PushableAudioSource>();
    auto track = factory->createAudioTrack(source, options);

    Napi::Object obj = constructor_.New({});
    LocalAudioTrackWrap* wrap = Napi::ObjectWrap<LocalAudioTrackWrap>::Unwrap(obj);
    wrap->track_ = track;
    wrap->factory_ = factory;
    wrap->audioSource_ = source;

    return scope.Escape(obj).ToObject();
}

LocalAudioTrackWrap::LocalAudioTrackWrap(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<LocalAudioTrackWrap>(info) {
}

LocalAudioTrackWrap::~LocalAudioTrackWrap() {
}

Napi::Value LocalAudioTrackWrap::GetName(const Napi::CallbackInfo& info) {
    if (!track_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), track_->getName());
}

Napi::Value LocalAudioTrackWrap::IsEnabled(const Napi::CallbackInfo& info) {
    if (!track_) return Napi::Boolean::New(info.Env(), false);
    return Napi::Boolean::New(info.Env(), track_->isEnabled());
}

void LocalAudioTrackWrap::SetEnabled(const Napi::CallbackInfo& info, const Napi::Value& value) {
    if (!track_) return;
    track_->setEnabled(value.As<Napi::Boolean>().Value());
}

Napi::Value LocalAudioTrackWrap::PushSamples(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 3) {
        Napi::TypeError::New(env, "Expected 3 arguments: samplesBuffer, sampleRate, numberOfChannels")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[0].IsBuffer()) {
        Napi::TypeError::New(env, "First argument must be a Buffer of int16 PCM samples")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto buffer = info[0].As<Napi::Buffer<int16_t>>();
    int sample_rate = info[1].As<Napi::Number>().Int32Value();
    size_t number_of_channels = info[2].As<Napi::Number>().Uint32Value();

    size_t total_samples = buffer.Length();
    size_t number_of_frames = total_samples / number_of_channels;

    if (audioSource_) {
        audioSource_->PushSamples(buffer.Data(), 16, sample_rate,
                                   number_of_channels, number_of_frames);
    }

    return env.Undefined();
}

}
