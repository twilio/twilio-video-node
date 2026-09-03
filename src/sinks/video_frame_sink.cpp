#include "video_frame_sink.h"

namespace twilio_video_node {

VideoFrameSink::VideoFrameSink(Napi::Env env, Napi::Function callback, size_t maxQueueDepth)
    : env_(env)
    , callback_(Napi::Persistent(callback))
    , asyncContext_(std::make_unique<AsyncContext>(env, maxQueueDepth)) {
}

VideoFrameSink::~VideoFrameSink() {
    close();
}

void VideoFrameSink::close() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (closed_) return;
    closed_ = true;
    if (asyncContext_) {
        nativeDropped_ = asyncContext_->droppedCount();
        asyncContext_->close();
        asyncContext_.reset();
    }
    callback_.Reset();
}

// This should return right away and not do any heavy tasks
void VideoFrameSink::OnFrame(const webrtc::VideoFrame& frame) {
    if (closed_) return;

    try {
        auto i420Buffer = frame.video_frame_buffer()->ToI420();
        if (!i420Buffer) return;

        VideoFrameData frameData;
        frameData.width = i420Buffer->width();
        frameData.height = i420Buffer->height();
        frameData.strideY = i420Buffer->StrideY();
        frameData.strideU = i420Buffer->StrideU();
        frameData.strideV = i420Buffer->StrideV();
        frameData.timestampUs = frame.timestamp_us();
        frameData.rotation = frame.rotation();
        frameData.frameId = nextFrameId_.fetch_add(1, std::memory_order_relaxed);
        frameData.rtpTimestamp = frame.rtp_timestamp();
        const auto& captureTs = frame.capture_time_identifier();
        frameData.hasCaptureTimestampUs = captureTs.has_value();
        frameData.captureTimestampUs = captureTs.has_value() ? captureTs->us() : 0;

        int ySize = frameData.strideY * frameData.height;
        int uvHeight = (frameData.height + 1) / 2;
        int uSize = frameData.strideU * uvHeight;
        int vSize = frameData.strideV * uvHeight;

        frameData.yPlane.resize(ySize);
        frameData.uPlane.resize(uSize);
        frameData.vPlane.resize(vSize);

        memcpy(frameData.yPlane.data(), i420Buffer->DataY(), ySize);
        memcpy(frameData.uPlane.data(), i420Buffer->DataU(), uSize);
        memcpy(frameData.vPlane.data(), i420Buffer->DataV(), vSize);

        deliverFrame(std::move(frameData));
    } catch (...) {
        // Swallow exceptions on WebRTC callback thread to prevent crash
    }
}

void VideoFrameSink::deliverFrame(VideoFrameData frameData) {
    if (closed_ || !asyncContext_) return;

    asyncContext_->dispatch([this, frameData = std::move(frameData)](Napi::Env env) {
        if (closed_ || callback_.IsEmpty()) return;

        Napi::HandleScope scope(env);

        auto yBuffer = Napi::Buffer<uint8_t>::Copy(env, frameData.yPlane.data(), frameData.yPlane.size());
        auto uBuffer = Napi::Buffer<uint8_t>::Copy(env, frameData.uPlane.data(), frameData.uPlane.size());
        auto vBuffer = Napi::Buffer<uint8_t>::Copy(env, frameData.vPlane.data(), frameData.vPlane.size());

        int uvWidth = (frameData.width + 1) / 2;
        int uvHeight = (frameData.height + 1) / 2;

        auto yPlane = Napi::Object::New(env);
        yPlane.Set("data", yBuffer);
        yPlane.Set("stride", Napi::Number::New(env, frameData.strideY));
        yPlane.Set("width", Napi::Number::New(env, frameData.width));
        yPlane.Set("height", Napi::Number::New(env, frameData.height));

        auto uPlane = Napi::Object::New(env);
        uPlane.Set("data", uBuffer);
        uPlane.Set("stride", Napi::Number::New(env, frameData.strideU));
        uPlane.Set("width", Napi::Number::New(env, uvWidth));
        uPlane.Set("height", Napi::Number::New(env, uvHeight));

        auto vPlane = Napi::Object::New(env);
        vPlane.Set("data", vBuffer);
        vPlane.Set("stride", Napi::Number::New(env, frameData.strideV));
        vPlane.Set("width", Napi::Number::New(env, uvWidth));
        vPlane.Set("height", Napi::Number::New(env, uvHeight));

        auto videoFrame = Napi::Object::New(env);
        videoFrame.Set("format", Napi::String::New(env, "I420"));
        videoFrame.Set("width", Napi::Number::New(env, frameData.width));
        videoFrame.Set("height", Napi::Number::New(env, frameData.height));
        videoFrame.Set("y", yPlane);
        videoFrame.Set("u", uPlane);
        videoFrame.Set("v", vPlane);
        videoFrame.Set("timestamp",
                       Napi::Number::New(env, static_cast<double>(frameData.timestampUs)));
        videoFrame.Set("frameId", Napi::Number::New(env, frameData.frameId));

        if (frameData.hasCaptureTimestampUs) {
            videoFrame.Set("captureTimestamp",
                           Napi::Number::New(env, static_cast<double>(frameData.captureTimestampUs)));
        }
        videoFrame.Set("rtpTimestamp",
                       Napi::Number::New(env, static_cast<double>(frameData.rtpTimestamp)));

        int rotation = 0;
        switch (frameData.rotation) {
            case webrtc::kVideoRotation_90: rotation = 90; break;
            case webrtc::kVideoRotation_180: rotation = 180; break;
            case webrtc::kVideoRotation_270: rotation = 270; break;
            default: rotation = 0; break;
        }
        if (rotation != 0) {
            videoFrame.Set("rotation", Napi::Number::New(env, rotation));
        }

        callback_.Call({videoFrame});
    });
}

}
