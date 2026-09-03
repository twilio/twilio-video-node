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

    // Frames shed at the native-to-JS transfer boundary, before the JS policy
    // queue sees them. Counted so a drop is never silent: the JS layer folds
    // this into the per-track DeliveryStats it reports. See the "drop location"
    // note in the API contract docs.
    uint64_t droppedCount() const { return dropped_.load(std::memory_order_relaxed); }

    // Current transfer-queue occupancy. Reported as part of queue depth.
    size_t queueDepth() const;

private:
    static void onAsync(uv_async_t* handle);
    void drain();

    uv_async_t* async_;
    mutable std::mutex mutex_;
    std::queue<std::function<void(Napi::Env)>> queue_;
    Napi::Env env_;
    std::atomic<bool> closed_{false};
    std::atomic<uint64_t> dropped_{0};
    size_t maxQueueDepth_;
};

}
