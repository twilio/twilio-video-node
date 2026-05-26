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
    uint16_t frameId;
    bool hasCaptureTimestampUs;
    int64_t captureTimestampUs;
    uint32_t rtpTimestamp;
};

class VideoFrameSink : public rtc::VideoSinkInterface<webrtc::VideoFrame> {
public:
    VideoFrameSink(Napi::Env env, Napi::Function callback);
    ~VideoFrameSink();

    void OnFrame(const webrtc::VideoFrame& frame) override;
    void close();

private:
    void deliverFrame(VideoFrameData frameData);

    Napi::Env env_;
    Napi::FunctionReference callback_;
    std::unique_ptr<AsyncContext> asyncContext_;
    std::atomic<bool> closed_{false};
    std::mutex mutex_;
};

}
