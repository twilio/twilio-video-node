#include "async_context.h"

namespace twilio_video_node {

AsyncContext::AsyncContext(Napi::Env env, size_t maxQueueDepth)
    : env_(env), maxQueueDepth_(maxQueueDepth) {
    uv_loop_t* loop;
    napi_get_uv_event_loop(env, &loop);
    async_ = new uv_async_t;
    uv_async_init(loop, async_, onAsync);
    async_->data = this;
}

AsyncContext::~AsyncContext() {
    close();
}

void AsyncContext::dispatch(std::function<void(Napi::Env)> fn) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_.load(std::memory_order_acquire)) return;

        // Drop oldest items when queue exceeds max depth (backpressure)
        // maxQueueDepth_ == 0 means unlimited (no dropping)
        while (maxQueueDepth_ > 0 && queue_.size() >= maxQueueDepth_) {
            queue_.pop();
        }
        queue_.push(std::move(fn));
    }
    // async_ may be null if close() raced with this call
    if (async_) uv_async_send(async_);
}

void AsyncContext::close() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_.load(std::memory_order_acquire)) return;
        closed_.store(true, std::memory_order_release);

        // Drain pending items so lambdas capturing shared_ptrs are freed
        std::queue<std::function<void(Napi::Env)>> empty;
        std::swap(queue_, empty);
    }
    // Null out data before uv_close so any in-flight onAsync sees null
    async_->data = nullptr;
    uv_close(reinterpret_cast<uv_handle_t*>(async_), [](uv_handle_t* h) {
        delete reinterpret_cast<uv_async_t*>(h);
    });
    async_ = nullptr;
}

void AsyncContext::onAsync(uv_async_t* handle) {
    auto* ctx = static_cast<AsyncContext*>(handle->data);
    if (!ctx) return;
    ctx->drain();
}

void AsyncContext::drain() {
    std::queue<std::function<void(Napi::Env)>> toProcess;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_.load(std::memory_order_acquire)) return;
        std::swap(toProcess, queue_);
    }

    while (!toProcess.empty()) {
        if (closed_.load(std::memory_order_acquire)) return;

        auto fn = std::move(toProcess.front());
        toProcess.pop();

        Napi::HandleScope scope(env_);
        // Catch JS exceptions to prevent corrupting native state
        try {
            fn(env_);
        } catch (const Napi::Error& e) {
            // JS exception already pending, just continue draining
        } catch (...) {
            // Swallow unexpected C++ exceptions from callbacks
        }
    }
}

}
