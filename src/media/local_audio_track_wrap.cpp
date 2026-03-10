#include "local_audio_track_wrap.h"
#include <webrtc/rtc_base/ref_counted_object.h>
#include <webrtc/rtc_base/checks.h>

namespace twilio_video_node {

// --- PushableAudioSource ---

PushableAudioSource::PushableAudioSource(rtc::scoped_refptr<NodeAudioDevice> adm)
    : adm_(std::move(adm)) {
}

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
    RTC_DCHECK_EQ(sample_rate, 48000);
    RTC_DCHECK_EQ(number_of_channels, 1);

    adm_->PushRecordingData(data, number_of_frames);
}

void PushableAudioSource::ClearBuffer() {
    adm_->ClearRecordingBuffer();
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
        InstanceMethod("clearBuffer", &LocalAudioTrackWrap::ClearBuffer),
    });

    constructor_ = Napi::Persistent(func);
    constructor_.SuppressDestruct();
    exports.Set("LocalAudioTrack", func);
}

Napi::Object LocalAudioTrackWrap::NewInstance(Napi::Env env,
                                               std::shared_ptr<twilio::media::MediaFactory> factory,
                                               const twilio::media::AudioTrackOptions& options,
                                               rtc::scoped_refptr<NodeAudioDevice> adm) {
    Napi::EscapableHandleScope scope(env);

    auto source = rtc::make_ref_counted<PushableAudioSource>(std::move(adm));
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

    if (info.Length() < 1 || !info[0].IsBuffer()) {
        Napi::TypeError::New(env, "Expected 1 argument: Buffer of int16 PCM samples (48kHz mono)")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto buffer = info[0].As<Napi::Buffer<int16_t>>();
    size_t number_of_frames = buffer.Length();

    if (audioSource_) {
        audioSource_->PushSamples(buffer.Data(), 16, 48000, 1, number_of_frames);
    }

    return env.Undefined();
}

Napi::Value LocalAudioTrackWrap::ClearBuffer(const Napi::CallbackInfo& info) {
    if (audioSource_) audioSource_->ClearBuffer();
    return info.Env().Undefined();
}

}
