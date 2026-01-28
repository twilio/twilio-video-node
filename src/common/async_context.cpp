#include "async_context.h"

namespace twilio_video_node {

AsyncContext::AsyncContext(Napi::Env env) : env_(env) {
    uv_loop_t* loop;
    napi_get_uv_event_loop(env, &loop);
    uv_async_init(loop, &async_, onAsync);
    async_.data = this;
}

AsyncContext::~AsyncContext() {
    close();
}

void AsyncContext::dispatch(std::function<void(Napi::Env)> fn) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_) return;
        queue_.push(std::move(fn));
    }
    uv_async_send(&async_);
}

void AsyncContext::close() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (closed_) return;
    closed_ = true;
    uv_close(reinterpret_cast<uv_handle_t*>(&async_), nullptr);
}

void AsyncContext::onAsync(uv_async_t* handle) {
    auto* ctx = static_cast<AsyncContext*>(handle->data);
    ctx->drain();
}

void AsyncContext::drain() {
    std::queue<std::function<void(Napi::Env)>> toProcess;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        std::swap(toProcess, queue_);
    }

    while (!toProcess.empty()) {
        auto fn = std::move(toProcess.front());
        toProcess.pop();

        // CRITICAL: Create HandleScope before calling into JavaScript
        Napi::HandleScope scope(env_);
        fn(env_);
    }
}

}
