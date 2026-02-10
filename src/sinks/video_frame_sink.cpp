#include "video_frame_sink.h"

namespace twilio_video_node {

VideoFrameSink::VideoFrameSink(Napi::Env env, Napi::Function callback)
    : env_(env)
    , callback_(Napi::Persistent(callback))
    , asyncContext_(std::make_unique<AsyncContext>(env)) {
}

VideoFrameSink::~VideoFrameSink() {
    close();
}

void VideoFrameSink::close() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (closed_) return;
    closed_ = true;
    if (asyncContext_) {
        asyncContext_->close();
    }
    callback_.Reset();
}

// This should return right away and not do any heavy tasks
void VideoFrameSink::OnFrame(const webrtc::VideoFrame& frame) {
    if (closed_) return;

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
}

void VideoFrameSink::deliverFrame(VideoFrameData frameData) {
    if (closed_ || !asyncContext_) return;

    asyncContext_->dispatch([this, frameData = std::move(frameData)](Napi::Env env) {
        if (closed_ || callback_.IsEmpty()) return;

        Napi::HandleScope scope(env);

        auto yBuffer = Napi::Buffer<uint8_t>::Copy(env, frameData.yPlane.data(), frameData.yPlane.size());
        auto uBuffer = Napi::Buffer<uint8_t>::Copy(env, frameData.uPlane.data(), frameData.uPlane.size());
        auto vBuffer = Napi::Buffer<uint8_t>::Copy(env, frameData.vPlane.data(), frameData.vPlane.size());

        auto metadata = Napi::Object::New(env);
        metadata.Set("width", Napi::Number::New(env, frameData.width));
        metadata.Set("height", Napi::Number::New(env, frameData.height));
        metadata.Set("strideY", Napi::Number::New(env, frameData.strideY));
        metadata.Set("strideU", Napi::Number::New(env, frameData.strideU));
        metadata.Set("strideV", Napi::Number::New(env, frameData.strideV));
        metadata.Set("timestampUs", Napi::Number::New(env, static_cast<double>(frameData.timestampUs)));

        int rotation = 0;
        switch (frameData.rotation) {
            case webrtc::kVideoRotation_90: rotation = 90; break;
            case webrtc::kVideoRotation_180: rotation = 180; break;
            case webrtc::kVideoRotation_270: rotation = 270; break;
            default: rotation = 0; break;
        }
        metadata.Set("rotation", Napi::Number::New(env, rotation));

        callback_.Call({yBuffer, uBuffer, vBuffer, metadata});
    });
}

}
