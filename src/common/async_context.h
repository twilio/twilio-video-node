#pragma once

#include <napi.h>
#include <uv.h>
#include <atomic>
#include <functional>
#include <memory>
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
    void requeueFront(std::queue<std::function<void(Napi::Env)>> pending);
    static void reportFatal(Napi::Env env, Napi::Value error);

    uv_async_t* async_;
    std::mutex mutex_;
    std::queue<std::function<void(Napi::Env)>> queue_;
    Napi::Env env_;
    std::atomic<bool> closed_{false};
    size_t maxQueueDepth_;

    // Cleared by the destructor. A queued callback can destroy the object it
    // was dispatched from, for instance a listener that calls room.dispose(),
    // so drain() holds a copy of this and stops touching members as soon as it
    // reads false rather than continuing through a freed `this`.
    std::shared_ptr<std::atomic<bool>> alive_ = std::make_shared<std::atomic<bool>>(true);
};

}
