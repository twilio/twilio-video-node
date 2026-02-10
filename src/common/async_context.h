#pragma once

#include <napi.h>
#include <uv.h>
#include <functional>
#include <mutex>
#include <queue>

namespace twilio_video_node {

class AsyncContext {
public:
    explicit AsyncContext(Napi::Env env);
    ~AsyncContext();

    void dispatch(std::function<void(Napi::Env)> fn);
    void close();

private:
    static void onAsync(uv_async_t* handle);
    void drain();

    uv_async_t* async_;
    std::mutex mutex_;
    std::queue<std::function<void(Napi::Env)>> queue_;
    Napi::Env env_;
    bool closed_ = false;
};

}
