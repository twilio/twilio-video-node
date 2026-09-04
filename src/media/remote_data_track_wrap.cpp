#include "remote_data_track_wrap.h"
#include <twilio/media/data_track_observer.h>
#include <algorithm>
#include <cstdint>
#include <limits>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace twilio_video_node {
namespace {

// DataTrack reports an unset option as UINT16_MAX, indistinguishable from a
// publisher's 65535. Both read back as unset.
Napi::Value SubscribedOptionOrNull(Napi::Env env, uint16_t value) {
    if (value == std::numeric_limits<uint16_t>::max()) {
        return env.Null();
    }
    return Napi::Number::New(env, value);
}

}

class RemoteDataTrackObserverImpl : public twilio::media::RemoteDataTrackObserver {
public:
    RemoteDataTrackObserverImpl() = default;

    // Registers `wrap` to receive future messages, alongside any other wrap
    // already registered. Unlike a RemoteParticipant, a data track's JS wrap is
    // not cached: reading a participant's dataTracks builds a fresh wrap on
    // every call, by design, matching RemoteVideoTrack/RemoteAudioTrack. Each
    // one the caller independently obtains and calls onMessage() on should
    // independently receive messages, the same way more than one video sink
    // can be attached to a single video track.
    void bind(RemoteDataTrackWrap* wrap, AsyncContext* ctx, std::shared_ptr<std::atomic<bool>> alive) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_.load(std::memory_order_acquire)) return;
        targets_.push_back({wrap, ctx, std::move(alive)});
    }

    // Removes `wrap` from delivery. Called from the wrap's destructor before
    // its AsyncContext is destroyed, so dispatch() is never called against a
    // dangling pointer.
    void unbind(RemoteDataTrackWrap* wrap) {
        std::lock_guard<std::mutex> lock(mutex_);
        targets_.erase(std::remove_if(targets_.begin(), targets_.end(),
                                      [wrap](const Target& t) { return t.wrap == wrap; }),
                       targets_.end());
    }

    // Called once, when the track itself is unsubscribed. No wrap can receive
    // further messages after this.
    void close() {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_.load(std::memory_order_acquire)) return;
        closed_.store(true, std::memory_order_release);
        targets_.clear();
    }

    void onMessage(twilio::media::RemoteDataTrack* track, const std::string& message) override {
        if (closed_.load(std::memory_order_acquire)) return;

        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_.load(std::memory_order_acquire)) return;

        for (const auto& target : targets_) {
            RemoteDataTrackWrap* wrap = target.wrap;
            auto alive = target.alive;
            target.ctx->dispatch([wrap, alive, message](Napi::Env env) {
                if (!alive->load(std::memory_order_acquire)) return;
                wrap->onMessage(message);
            });
        }
    }

    void onMessage(twilio::media::RemoteDataTrack* track, const uint8_t* message, size_t size) override {
        if (closed_.load(std::memory_order_acquire)) return;

        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_.load(std::memory_order_acquire)) return;

        std::vector<uint8_t> dataCopy(message, message + size);
        for (const auto& target : targets_) {
            RemoteDataTrackWrap* wrap = target.wrap;
            auto alive = target.alive;
            target.ctx->dispatch([wrap, alive, dataCopy](Napi::Env env) {
                if (!alive->load(std::memory_order_acquire)) return;
                wrap->onBufferMessage(dataCopy.data(), dataCopy.size());
            });
        }
    }

private:
    struct Target {
        RemoteDataTrackWrap* wrap;
        AsyncContext* ctx;
        std::shared_ptr<std::atomic<bool>> alive;
    };

    std::vector<Target> targets_;
    std::atomic<bool> closed_{false};
    std::mutex mutex_;
};

namespace {

std::mutex g_dataTrackObserversMutex;
std::unordered_map<std::string, std::shared_ptr<RemoteDataTrackObserverImpl>> g_dataTrackObservers;

}  // namespace

Napi::FunctionReference RemoteDataTrackWrap::constructor_;

void RemoteDataTrackWrap::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "RemoteDataTrack", {
        InstanceAccessor("name", &RemoteDataTrackWrap::GetName, nullptr),
        InstanceAccessor("kind", &RemoteDataTrackWrap::GetKind, nullptr),
        InstanceAccessor("sid", &RemoteDataTrackWrap::GetSid, nullptr),
        InstanceAccessor("maxPacketLifeTime", &RemoteDataTrackWrap::GetMaxPacketLifeTime, nullptr),
        InstanceAccessor("maxRetransmits", &RemoteDataTrackWrap::GetMaxRetransmits, nullptr),
        InstanceAccessor("reliable", &RemoteDataTrackWrap::IsReliable, nullptr),
        InstanceAccessor("ordered", &RemoteDataTrackWrap::IsOrdered, nullptr),
        InstanceMethod("onMessage", &RemoteDataTrackWrap::OnMessage),
        InstanceMethod("removeMessageCallback", &RemoteDataTrackWrap::RemoveMessageCallback),
    });

    constructor_ = Napi::Persistent(func);
    constructor_.SuppressDestruct();
    exports.Set("RemoteDataTrack", func);
}

Napi::Object RemoteDataTrackWrap::NewInstance(Napi::Env env, std::shared_ptr<twilio::media::RemoteDataTrack> track) {
    Napi::EscapableHandleScope scope(env);

    Napi::Object obj = constructor_.New({});
    RemoteDataTrackWrap* wrap = Napi::ObjectWrap<RemoteDataTrackWrap>::Unwrap(obj);
    wrap->track_ = track;
    wrap->asyncContext_ = std::make_unique<AsyncContext>(env, 0);

    std::string sid = track->getSid();
    std::shared_ptr<RemoteDataTrackObserverImpl> observer;
    {
        std::lock_guard<std::mutex> lock(g_dataTrackObserversMutex);
        auto it = g_dataTrackObservers.find(sid);
        if (it != g_dataTrackObservers.end()) {
            observer = it->second;
        } else {
            observer = std::make_shared<RemoteDataTrackObserverImpl>();
            track->setObserver(observer);
            g_dataTrackObservers[sid] = observer;
        }
    }
    wrap->observer_ = observer;
    observer->bind(wrap, wrap->asyncContext_.get(), wrap->alive_);

    return scope.Escape(obj).ToObject();
}

void RemoteDataTrackWrap::CloseObserver(std::shared_ptr<twilio::media::RemoteDataTrack> track) {
    track->setObserver(std::weak_ptr<twilio::media::RemoteDataTrackObserver>());

    std::lock_guard<std::mutex> lock(g_dataTrackObserversMutex);
    auto it = g_dataTrackObservers.find(track->getSid());
    if (it != g_dataTrackObservers.end()) {
        it->second->close();
        g_dataTrackObservers.erase(it);
    }
}

RemoteDataTrackWrap::RemoteDataTrackWrap(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<RemoteDataTrackWrap>(info) {
}

RemoteDataTrackWrap::~RemoteDataTrackWrap() {
    alive_->store(false, std::memory_order_release);
    // Removes this wrap from delivery, but the observer itself is not owned by
    // any one wrap: it is detached from the track and closed once,
    // deterministically, when the track is unsubscribed (see CloseObserver),
    // since a track can have zero or many live wraps for it at any moment.
    if (observer_) {
        observer_->unbind(this);
    }
    if (asyncContext_) {
        asyncContext_->close();
    }
}

void RemoteDataTrackWrap::onMessage(const std::string& message) {
    if (messageCallback_.IsEmpty()) return;
    Napi::HandleScope scope(messageCallback_.Env());
    messageCallback_.Call({Napi::String::New(messageCallback_.Env(), message)});
}

void RemoteDataTrackWrap::onBufferMessage(const uint8_t* data, size_t length) {
    if (messageCallback_.IsEmpty()) return;
    Napi::Env env = messageCallback_.Env();
    Napi::HandleScope scope(env);
    auto buffer = Napi::Buffer<uint8_t>::Copy(env, data, length);
    messageCallback_.Call({buffer});
}

Napi::Value RemoteDataTrackWrap::GetKind(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), "data");
}

Napi::Value RemoteDataTrackWrap::GetName(const Napi::CallbackInfo& info) {
    if (!track_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), track_->getName());
}

Napi::Value RemoteDataTrackWrap::GetSid(const Napi::CallbackInfo& info) {
    if (!track_) return info.Env().Undefined();
    return Napi::String::New(info.Env(), track_->getSid());
}

Napi::Value RemoteDataTrackWrap::GetMaxPacketLifeTime(const Napi::CallbackInfo& info) {
    // Null, not undefined: the JS type for this property is `number | null`.
    if (!track_) return info.Env().Null();
    return SubscribedOptionOrNull(info.Env(), track_->getMaxPacketLifeTime());
}

Napi::Value RemoteDataTrackWrap::GetMaxRetransmits(const Napi::CallbackInfo& info) {
    if (!track_) return info.Env().Null();
    return SubscribedOptionOrNull(info.Env(), track_->getMaxRetransmits());
}

Napi::Value RemoteDataTrackWrap::IsReliable(const Napi::CallbackInfo& info) {
    if (!track_) return Napi::Boolean::New(info.Env(), false);
    return Napi::Boolean::New(info.Env(), track_->isReliable());
}

Napi::Value RemoteDataTrackWrap::IsOrdered(const Napi::CallbackInfo& info) {
    if (!track_) return Napi::Boolean::New(info.Env(), false);
    return Napi::Boolean::New(info.Env(), track_->isOrdered());
}

Napi::Value RemoteDataTrackWrap::OnMessage(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Expected callback function").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    messageCallback_.Reset();
    messageCallback_ = Napi::Persistent(info[0].As<Napi::Function>());

    return env.Undefined();
}

Napi::Value RemoteDataTrackWrap::RemoveMessageCallback(const Napi::CallbackInfo& info) {
    messageCallback_.Reset();
    return info.Env().Undefined();
}

}
