#include "node_audio_device.h"

#include <algorithm>
#include <webrtc/rtc_base/ref_counted_object.h>

namespace twilio_video_node {

NodeAudioDevice::NodeAudioDevice(webrtc::TaskQueueFactory* task_queue_factory)
    : task_queue_factory_(task_queue_factory) {
}

NodeAudioDevice::~NodeAudioDevice() {
    Terminate();
}

rtc::scoped_refptr<NodeAudioDevice> NodeAudioDevice::Create(
    webrtc::TaskQueueFactory* task_queue_factory) {
    return rtc::scoped_refptr<NodeAudioDevice>(
        new rtc::RefCountedObject<NodeAudioDevice>(task_queue_factory));
}

bool NodeAudioDevice::PushRecordingData(const int16_t* data, size_t num_frames) {
    std::lock_guard<std::mutex> lock(rec_mutex_);

    rec_buffer_.insert(rec_buffer_.end(), data, data + num_frames);

    // Bounded publish queue. A producer pushing faster than the 10 ms drain
    // sheds the oldest samples rather than accumulating latency; every shed
    // chunk is counted so the loss is observable through getWriteStats().
    const size_t max_samples =
        max_queue_chunks_.load(std::memory_order_relaxed) * kSamplesPer10Ms;
    if (rec_buffer_.size() > max_samples) {
        size_t excess = rec_buffer_.size() - max_samples;
        rec_buffer_.erase(rec_buffer_.begin(), rec_buffer_.begin() + excess);
        dropped_chunks_.fetch_add(1, std::memory_order_relaxed);
        return false;
    }
    return true;
}

void NodeAudioDevice::SetMaxQueueChunks(size_t chunks) {
    if (chunks < 1) chunks = 1;
    if (chunks > 4800) chunks = 4800;  // hard ceiling: ~48 s, guards misconfiguration
    max_queue_chunks_.store(chunks, std::memory_order_relaxed);
}

size_t NodeAudioDevice::queueDepthChunks() const {
    std::lock_guard<std::mutex> lock(rec_mutex_);
    return rec_buffer_.size() / kSamplesPer10Ms;
}

void NodeAudioDevice::ClearRecordingBuffer() {
    std::lock_guard<std::mutex> lock(rec_mutex_);
    rec_buffer_.clear();
}

int32_t NodeAudioDevice::Init() {
    {
        webrtc::MutexLock lock(&mutex_);
        if (initialized_) return 0;

        audio_queue_ = task_queue_factory_->CreateTaskQueue(
            "NodeAudioDevice", webrtc::TaskQueueFactory::Priority::NORMAL);
        initialized_ = true;
    }

    // Start repeating task outside lock to avoid deadlock
    // (the lambda also acquires mutex_).
    rtc::scoped_refptr<NodeAudioDevice> self(this);
    webrtc::RepeatingTaskHandle::Start(audio_queue_.get(), [self]() {
        // --- Recording: always emit one 10ms frame (real data or silence) ---
        int16_t frame[kSamplesPer10Ms] = {};
        {
            std::lock_guard<std::mutex> lock(self->rec_mutex_);
            size_t to_copy = std::min(self->rec_buffer_.size(), static_cast<size_t>(kSamplesPer10Ms));
            std::copy(self->rec_buffer_.begin(), self->rec_buffer_.begin() + to_copy, frame);
            self->rec_buffer_.erase(self->rec_buffer_.begin(), self->rec_buffer_.begin() + to_copy);
        }

        webrtc::MutexLock lock(&self->mutex_);
        if (self->recording_ && self->audio_transport_) {
            uint32_t new_mic_level = 0;
            self->audio_transport_->RecordedDataIsAvailable(
                frame, kSamplesPer10Ms,
                kBytesPerSample, kChannels, kSampleRate,
                0, 0, 0, false, new_mic_level);
        }

        // --- Playout: pump NeedMorePlayData so WebRTC accepts inbound audio ---
        if (self->playing_ && self->audio_transport_) {
            int16_t playout_frame[kSamplesPer10Ms] = {};
            size_t n_samples_out = 0;
            int64_t elapsed_time_ms = -1;
            int64_t ntp_time_ms = -1;
            self->audio_transport_->NeedMorePlayData(
                kSamplesPer10Ms, kBytesPerSample, kChannels, kSampleRate,
                playout_frame, n_samples_out,
                &elapsed_time_ms, &ntp_time_ms);
        }

        return webrtc::TimeDelta::Millis(10);
    });

    return 0;
}

int32_t NodeAudioDevice::Terminate() {
    // Move queue out and destroy outside lock to avoid deadlock:
    // the 10ms task lambda also acquires mutex_.
    std::unique_ptr<webrtc::TaskQueueBase, webrtc::TaskQueueDeleter> queue;
    {
        webrtc::MutexLock lock(&mutex_);
        if (!initialized_) return 0;
        queue = std::move(audio_queue_);
        initialized_ = false;
        playing_ = false;
        recording_ = false;
        audio_transport_ = nullptr;
    }
    queue.reset();
    return 0;
}

int32_t NodeAudioDevice::RegisterAudioCallback(webrtc::AudioTransport* transport) {
    webrtc::MutexLock lock(&mutex_);
    audio_transport_ = transport;
    return 0;
}

int32_t NodeAudioDevice::StartPlayout() {
    webrtc::MutexLock lock(&mutex_);
    playing_ = true;
    return 0;
}

int32_t NodeAudioDevice::StopPlayout() {
    webrtc::MutexLock lock(&mutex_);
    playing_ = false;
    return 0;
}

bool NodeAudioDevice::Playing() const {
    webrtc::MutexLock lock(&mutex_);
    return playing_;
}

int32_t NodeAudioDevice::StartRecording() {
    webrtc::MutexLock lock(&mutex_);
    recording_ = true;
    return 0;
}

int32_t NodeAudioDevice::StopRecording() {
    webrtc::MutexLock lock(&mutex_);
    recording_ = false;
    return 0;
}

bool NodeAudioDevice::Recording() const {
    webrtc::MutexLock lock(&mutex_);
    return recording_;
}

bool NodeAudioDevice::Initialized() const {
    webrtc::MutexLock lock(&mutex_);
    return initialized_;
}

}  // namespace twilio_video_node
