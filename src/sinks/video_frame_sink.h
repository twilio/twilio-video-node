#pragma once

#include <napi.h>
#include <webrtc/api/video/video_frame.h>
#include <webrtc/api/video/video_sink_interface.h>
#include <webrtc/api/video/i420_buffer.h>
#include "../common/async_context.h"
#include <mutex>
#include <atomic>

namespace twilio_video_node {

struct VideoFrameData {
    std::vector<uint8_t> yPlane;
    std::vector<uint8_t> uPlane;
    std::vector<uint8_t> vPlane;
    int width;
    int height;
    int strideY;
    int strideU;
    int strideV;
    int64_t timestampUs;
    webrtc::VideoRotation rotation;
    uint32_t frameId;
    bool hasCaptureTimestampUs;
    int64_t captureTimestampUs;
    uint32_t rtpTimestamp;
};

class VideoFrameSink : public rtc::VideoSinkInterface<webrtc::VideoFrame> {
public:
    // `maxQueueDepth` bounds the native-to-JS transfer queue. The JS layer sets
    // it from the caller's FrameDeliveryOptions so a 'latest' consumer does not
    // hold a deep queue of ~1.3 MB frames in native memory.
    VideoFrameSink(Napi::Env env, Napi::Function callback,
                   size_t maxQueueDepth = AsyncContext::kDefaultMaxQueueDepth);
    ~VideoFrameSink();

    void OnFrame(const webrtc::VideoFrame& frame) override;
    void close();

    uint64_t droppedCount() const {
        return asyncContext_ ? asyncContext_->droppedCount() : nativeDropped_;
    }
    size_t queueDepth() const { return asyncContext_ ? asyncContext_->queueDepth() : 0; }

private:
    void deliverFrame(VideoFrameData frameData);

    Napi::Env env_;
    Napi::FunctionReference callback_;
    std::unique_ptr<AsyncContext> asyncContext_;
    std::atomic<bool> closed_{false};
    std::mutex mutex_;
    // libwebrtc's VideoFrame::id() is not populated on the receive path (it
    // reads 0 for every frame), so the SDK generates the per-track counter the
    // frame contract promises.
    std::atomic<uint32_t> nextFrameId_{0};
    // Survives asyncContext_ being reset by close(), so a final stats read
    // after teardown still reports the drops that happened.
    uint64_t nativeDropped_{0};
};

}
