#pragma once

#include <mutex>
#include <deque>
#include <webrtc/modules/audio_device/include/audio_device.h>
#include <webrtc/api/task_queue/task_queue_factory.h>
#include <webrtc/api/task_queue/task_queue_base.h>
#include <webrtc/rtc_base/synchronization/mutex.h>
#include <webrtc/rtc_base/task_utils/repeating_task.h>

namespace twilio_video_node {

// Server-side AudioDeviceModule that:
// 1. Pumps NeedMorePlayData every 10ms (required for receiving audio)
// 2. Feeds pushed audio into RecordedDataIsAvailable (required for sending audio)
//
// WebRTC sends audio through the ADM recording path, NOT through AudioSourceInterface sinks.
// So pushSamples data must be routed here → RecordedDataIsAvailable → WebRTC encoder → RTP.
class NodeAudioDevice : public webrtc::AudioDeviceModule {
public:
    // Fixed capture format: WebRTC's encoder path here is wired for 48kHz mono
    // 16-bit PCM. Callers feeding PushRecordingData must match this format.
    static constexpr int kSampleRate = 48000;
    static constexpr int kChannels = 1;
    static constexpr int kBitsPerSample = 16;

    static rtc::scoped_refptr<NodeAudioDevice> Create(
        webrtc::TaskQueueFactory* task_queue_factory);

    // Feed 48kHz mono audio data into the ADM recording path. Called from PushableAudioSource.
    void PushRecordingData(const int16_t* data, size_t num_frames);

    // Clear the recording buffer (used for interruption).
    void ClearRecordingBuffer();

    // --- Non-trivial overrides ---
    int32_t Init() override;
    int32_t Terminate() override;
    int32_t RegisterAudioCallback(webrtc::AudioTransport* transport) override;
    int32_t StartPlayout() override;
    int32_t StopPlayout() override;
    bool Playing() const override;
    int32_t StartRecording() override;
    int32_t StopRecording() override;
    bool Recording() const override;
    bool Initialized() const override;

    // --- Trivial overrides (all return 0/false/true as appropriate) ---
    int32_t ActiveAudioLayer(AudioLayer*) const override { return 0; }
    int32_t RegisterRecordingSink(webrtc::AudioTrackSinkInterface*) override { return 0; }
    int16_t PlayoutDevices() override { return 0; }
    int16_t RecordingDevices() override { return 0; }
    int32_t PlayoutDeviceName(uint16_t, char[webrtc::kAdmMaxDeviceNameSize],
                              char[webrtc::kAdmMaxGuidSize]) override { return 0; }
    int32_t RecordingDeviceName(uint16_t, char[webrtc::kAdmMaxDeviceNameSize],
                                char[webrtc::kAdmMaxGuidSize]) override { return 0; }
    int32_t SetPlayoutDevice(uint16_t) override { return 0; }
    int32_t SetPlayoutDevice(WindowsDeviceType) override { return 0; }
    int32_t SetRecordingDevice(uint16_t) override { return 0; }
    int32_t SetRecordingDevice(WindowsDeviceType) override { return 0; }
    int32_t PlayoutIsAvailable(bool* available) override { *available = true; return 0; }
    int32_t InitPlayout() override { return 0; }
    bool PlayoutIsInitialized() const override { return true; }
    int32_t RecordingIsAvailable(bool* available) override { *available = true; return 0; }
    int32_t InitRecording() override { return 0; }
    bool RecordingIsInitialized() const override { return true; }
    int32_t InitSpeaker() override { return 0; }
    bool SpeakerIsInitialized() const override { return true; }
    int32_t InitMicrophone() override { return 0; }
    bool MicrophoneIsInitialized() const override { return true; }
    int32_t SpeakerVolumeIsAvailable(bool* available) override { *available = false; return 0; }
    int32_t SetSpeakerVolume(uint32_t) override { return 0; }
    int32_t SpeakerVolume(uint32_t* volume) const override { *volume = 0; return 0; }
    int32_t MaxSpeakerVolume(uint32_t* max) const override { *max = 0; return 0; }
    int32_t MinSpeakerVolume(uint32_t* min) const override { *min = 0; return 0; }
    int32_t MicrophoneVolumeIsAvailable(bool* available) override { *available = false; return 0; }
    int32_t SetMicrophoneVolume(uint32_t) override { return 0; }
    int32_t MicrophoneVolume(uint32_t* volume) const override { *volume = 0; return 0; }
    int32_t MaxMicrophoneVolume(uint32_t* max) const override { *max = 0; return 0; }
    int32_t MinMicrophoneVolume(uint32_t* min) const override { *min = 0; return 0; }
    int32_t SpeakerMuteIsAvailable(bool* available) override { *available = false; return 0; }
    int32_t SetSpeakerMute(bool) override { return 0; }
    int32_t SpeakerMute(bool* enabled) const override { *enabled = false; return 0; }
    int32_t MicrophoneMuteIsAvailable(bool* available) override { *available = false; return 0; }
    int32_t SetMicrophoneMute(bool) override { return 0; }
    int32_t MicrophoneMute(bool* enabled) const override { *enabled = false; return 0; }
    int32_t StereoPlayoutIsAvailable(bool* available) const override { *available = false; return 0; }
    int32_t SetStereoPlayout(bool) override { return 0; }
    int32_t StereoPlayout(bool* enabled) const override { *enabled = false; return 0; }
    int32_t StereoRecordingIsAvailable(bool* available) const override { *available = false; return 0; }
    int32_t SetStereoRecording(bool) override { return 0; }
    int32_t StereoRecording(bool* enabled) const override { *enabled = false; return 0; }
    int32_t PlayoutDelay(uint16_t* delayMS) const override { *delayMS = 0; return 0; }
    bool BuiltInAECIsAvailable() const override { return false; }
    bool BuiltInAGCIsAvailable() const override { return false; }
    bool BuiltInNSIsAvailable() const override { return false; }
    int32_t EnableBuiltInAEC(bool) override { return -1; }
    int32_t EnableBuiltInAGC(bool) override { return -1; }
    int32_t EnableBuiltInNS(bool) override { return -1; }

    // Use Create() factory method
    explicit NodeAudioDevice(webrtc::TaskQueueFactory* task_queue_factory);
    ~NodeAudioDevice() override;

private:
    webrtc::TaskQueueFactory* task_queue_factory_;
    std::unique_ptr<webrtc::TaskQueueBase, webrtc::TaskQueueDeleter> audio_queue_;

    mutable webrtc::Mutex mutex_;
    webrtc::AudioTransport* audio_transport_ RTC_GUARDED_BY(mutex_) = nullptr;
    bool initialized_ RTC_GUARDED_BY(mutex_) = false;
    bool playing_ RTC_GUARDED_BY(mutex_) = false;
    bool recording_ RTC_GUARDED_BY(mutex_) = false;

    static constexpr int kSamplesPer10Ms = kSampleRate / 100;  // 480
    static constexpr int kBytesPerSample = sizeof(int16_t);
    // Recording buffer: filled by PushRecordingData, drained 480 samples per 10ms tick.
    // Growable deque so burst audio doesn't overflow.
    std::mutex rec_mutex_;
    std::deque<int16_t> rec_buffer_;
};

}  // namespace twilio_video_node
