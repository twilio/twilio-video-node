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
    std::lock_guard<std::mutex> lock(mutex_);
    if (closed_.load(std::memory_order_acquire)) return;

    // Drop oldest items when queue exceeds max depth (backpressure)
    // maxQueueDepth_ == 0 means unlimited (no dropping)
    while (maxQueueDepth_ > 0 && queue_.size() >= maxQueueDepth_) {
        queue_.pop();
    }
    queue_.push(std::move(fn));

    if (async_) uv_async_send(async_);
}

void AsyncContext::close() {
    uv_async_t* handle = nullptr;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_.load(std::memory_order_acquire)) return;
        closed_.store(true, std::memory_order_release);

        // Drain pending items so lambdas capturing shared_ptrs are freed
        std::queue<std::function<void(Napi::Env)>> empty;
        std::swap(queue_, empty);

        handle = async_;
        async_ = nullptr;
    }
    if (handle) {
        handle->data = nullptr;
        uv_close(reinterpret_cast<uv_handle_t*>(handle), [](uv_handle_t* h) {
            delete reinterpret_cast<uv_async_t*>(h);
        });
    }
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
        // A throwing listener stops this drain, the way a throwing EventEmitter
        // listener stops an emit. The exception is left pending so Node reports it
        // as an uncaughtException; swallowing it here hid consumer bugs entirely,
        // since nothing else on this path logs. Events queued behind it go back on
        // the queue so an app with an uncaughtException handler still receives them.
        try {
            fn(env_);
        } catch (const Napi::Error& e) {
            requeueFront(std::move(toProcess));
            reportFatal(e.Value());
            return;
        } catch (const std::exception& e) {
            requeueFront(std::move(toProcess));
            reportFatal(Napi::Error::New(env_, e.what()).Value());
            return;
        } catch (...) {
            requeueFront(std::move(toProcess));
            reportFatal(Napi::Error::New(env_, "Unknown C++ exception in event callback").Value());
            return;
        }
    }
}

// drain() runs from a libuv callback, not a Node callback scope, so a pending
// JS exception would have no frame to unwind into. napi_fatal_exception is the
// documented way to surface one from here: it reaches the process as an
// 'uncaughtException'.
void AsyncContext::reportFatal(Napi::Value error) {
    napi_fatal_exception(env_, error);
}

void AsyncContext::requeueFront(std::queue<std::function<void(Napi::Env)>> pending) {
    if (pending.empty()) return;

    std::lock_guard<std::mutex> lock(mutex_);
    if (closed_.load(std::memory_order_acquire)) return;

    while (!queue_.empty()) {
        pending.push(std::move(queue_.front()));
        queue_.pop();
    }
    std::swap(queue_, pending);

    if (async_) uv_async_send(async_);
}

}
