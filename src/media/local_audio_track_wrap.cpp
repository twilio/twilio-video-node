#include "local_audio_track_wrap.h"
#include <webrtc/rtc_base/ref_counted_object.h>
#include <webrtc/rtc_base/checks.h>

#include <cmath>
#include <limits>

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

bool PushableAudioSource::PushSamples(const int16_t* data, int bits_per_sample,
                                       int sample_rate, size_t number_of_channels,
                                       size_t number_of_frames) {
    RTC_DCHECK_EQ(bits_per_sample, NodeAudioDevice::kBitsPerSample);
    RTC_DCHECK_EQ(sample_rate, NodeAudioDevice::kSampleRate);
    RTC_DCHECK_EQ(number_of_channels, static_cast<size_t>(NodeAudioDevice::kChannels));

    return adm_->PushRecordingData(data, number_of_frames);
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
        InstanceAccessor("kind", &LocalAudioTrackWrap::GetKind, nullptr),
        InstanceAccessor("enabled", &LocalAudioTrackWrap::IsEnabled, &LocalAudioTrackWrap::SetEnabled),
        InstanceMethod("write", &LocalAudioTrackWrap::Write),
        InstanceMethod("clearBuffer", &LocalAudioTrackWrap::ClearBuffer),
        InstanceMethod("getWriteStats", &LocalAudioTrackWrap::GetWriteStats),
        InstanceMethod("_configureSource", &LocalAudioTrackWrap::ConfigureSource),
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

Napi::Value LocalAudioTrackWrap::GetKind(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), "audio");
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

Napi::Value LocalAudioTrackWrap::Write(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "write() expects an AudioFrameInput object").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object frame = info[0].As<Napi::Object>();

    if (!frame.Has("pcm") || !frame.Get("pcm").IsBuffer()) {
        Napi::TypeError::New(env, "AudioFrameInput requires a pcm Buffer").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Value framesVal = frame.Get("frames");
    if (!framesVal.IsNumber()) {
        Napi::TypeError::New(env, "AudioFrameInput requires frames (number of samples per channel)")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
    double framesDouble = framesVal.As<Napi::Number>().DoubleValue();
    if (!std::isfinite(framesDouble) ||
        framesDouble != std::trunc(framesDouble) ||
        framesDouble <= 0 ||
        framesDouble > static_cast<double>(std::numeric_limits<int64_t>::max())) {
        Napi::RangeError::New(env, "AudioFrameInput frames must be a positive integer")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto buffer = frame.Get("pcm").As<Napi::Buffer<int16_t>>();
    size_t number_of_frames = static_cast<size_t>(framesDouble);

    // pcm holds int16_t samples; for mono, length in samples must be >= frames.
    if (buffer.Length() < number_of_frames) {
        Napi::RangeError::New(env, "AudioFrameInput pcm buffer is smaller than frames")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!audioSource_) {
        Napi::Error::New(env, "LocalAudioTrack is not bound to a source").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Optional timestamp, microseconds, same contract as the video path.
    int64_t timestampUs = rtc::TimeMicros();
    if (frame.Has("timestamp") && !frame.Get("timestamp").IsUndefined()) {
        Napi::Value tsVal = frame.Get("timestamp");
        if (!tsVal.IsNumber()) {
            Napi::TypeError::New(env, "AudioFrameInput.timestamp must be a number (microseconds)")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
        double ts = tsVal.As<Napi::Number>().DoubleValue();
        if (!std::isfinite(ts) || ts != std::trunc(ts) || ts < 0 || ts > 9007199254740991.0) {
            Napi::RangeError::New(env,
                "AudioFrameInput.timestamp must be a non-negative whole number of microseconds "
                "within Number.MAX_SAFE_INTEGER")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
        timestampUs = static_cast<int64_t>(ts);
    }

    bool accepted = audioSource_->PushSamples(buffer.Data(),
                                              NodeAudioDevice::kBitsPerSample,
                                              NodeAudioDevice::kSampleRate,
                                              NodeAudioDevice::kChannels,
                                              number_of_frames);
    if (accepted) {
        framesWritten_++;
        if (hasLastTimestamp_ && timestampUs <= lastTimestampUs_) timestampRegressions_++;
        hasLastTimestamp_ = true;
        lastTimestampUs_ = timestampUs;
    } else {
        framesDropped_++;
    }
    return Napi::Boolean::New(env, accepted);
}

Napi::Value LocalAudioTrackWrap::ConfigureSource(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsObject()) return env.Undefined();
    Napi::Object opts = info[0].As<Napi::Object>();
    if (opts.Has("maxQueue") && opts.Get("maxQueue").IsNumber() && audioSource_) {
        double q = opts.Get("maxQueue").As<Napi::Number>().DoubleValue();
        if (std::isfinite(q) && q >= 1) {
            NodeAudioDevice* adm = audioSource_->adm();
            if (adm) adm->SetMaxQueueChunks(static_cast<size_t>(q));
        }
    }
    return env.Undefined();
}

Napi::Value LocalAudioTrackWrap::GetWriteStats(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto out = Napi::Object::New(env);
    out.Set("framesWritten", Napi::Number::New(env, static_cast<double>(framesWritten_)));
    out.Set("framesDropped", Napi::Number::New(env, static_cast<double>(framesDropped_)));
    out.Set("timestampRegressions",
            Napi::Number::New(env, static_cast<double>(timestampRegressions_)));
    NodeAudioDevice* adm = audioSource_ ? audioSource_->adm() : nullptr;
    out.Set("sendQueueDepth",
            Napi::Number::New(env, adm ? static_cast<double>(adm->queueDepthChunks()) : 0));
    out.Set("maxQueue",
            Napi::Number::New(env, adm ? static_cast<double>(adm->maxQueueChunks()) : 0));
    if (hasLastTimestamp_) {
        out.Set("lastTimestamp", Napi::Number::New(env, static_cast<double>(lastTimestampUs_)));
    }
    return out;
}

Napi::Value LocalAudioTrackWrap::ClearBuffer(const Napi::CallbackInfo& info) {
    if (audioSource_) audioSource_->ClearBuffer();
    return info.Env().Undefined();
}

}
