#pragma once

#include <napi.h>
#include <uv.h>
#include <atomic>
#include <functional>
#include <mutex>
#include <queue>

namespace twilio_video_node {

class AsyncContext {
public:
    static constexpr size_t kDefaultMaxQueueDepth = 5;

    explicit AsyncContext(Napi::Env env, size_t maxQueueDepth = kDefaultMaxQueueDepth);
    ~AsyncContext();

    void dispatch(std::function<void(Napi::Env)> fn);
    void close();
    bool isClosed() const { return closed_.load(std::memory_order_acquire); }

private:
    static void onAsync(uv_async_t* handle);
    void drain();

    uv_async_t* async_;
    std::mutex mutex_;
    std::queue<std::function<void(Napi::Env)>> queue_;
    Napi::Env env_;
    std::atomic<bool> closed_{false};
    size_t maxQueueDepth_;
};

}
