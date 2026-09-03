#pragma once

#include <napi.h>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <twilio/media/data_track_observer.h>
#include "../common/async_context.h"
#include <twilio/media/media_factory.h>
#include <twilio/media/data_track.h>
#include <twilio/media/data_track_options.h>

namespace twilio_video_node {

class LocalDataTrackWrap;

/**
 * Bridges rtc-cpp's send-completion callbacks back to the JS promise returned
 * by send(). Callbacks arrive on the notifier thread, so `owner_` is guarded
 * and cleared by detach() before the wrap goes away.
 */
class LocalDataTrackSendObserver : public twilio::media::LocalDataTrackObserver {
public:
    explicit LocalDataTrackSendObserver(LocalDataTrackWrap* owner) : owner_(owner) {}

    /** Stop forwarding; called when the wrap is destroyed. */
    void detach();

    void onAvailableBufferSizeChanged(twilio::media::LocalDataTrack*, size_t, size_t) override {}
    void onSendProcessedWithFailure(twilio::media::LocalDataTrack* track,
                                    twilio::media::LocalDataTrackMessageId message_id,
                                    const twilio::video::Error twilio_error) override;
    void onSendProcessedSuccessfully(twilio::media::LocalDataTrack* track,
                                     twilio::media::LocalDataTrackMessageId message_id) override;

private:
    std::mutex mutex_;
    LocalDataTrackWrap* owner_;
};

class LocalDataTrackWrap : public Napi::ObjectWrap<LocalDataTrackWrap> {
public:
    static void Init(Napi::Env env, Napi::Object exports);
    static Napi::Object NewInstance(Napi::Env env,
                                    std::shared_ptr<twilio::media::MediaFactory> factory,
                                    const twilio::media::DataTrackOptions& options);
    static bool IsInstance(Napi::Object obj);

    LocalDataTrackWrap(const Napi::CallbackInfo& info);
    ~LocalDataTrackWrap();

    std::shared_ptr<twilio::media::LocalDataTrack> getTrack() const { return track_; }

private:
    static Napi::FunctionReference constructor_;

    Napi::Value GetName(const Napi::CallbackInfo& info);
    Napi::Value GetKind(const Napi::CallbackInfo& info);
    Napi::Value Send(const Napi::CallbackInfo& info);

    /** @internal Resolves the pending promise for `id`. JS thread only. */
    void settleSend(uint64_t id, bool ok, const std::string& error);
    friend class LocalDataTrackSendObserver;
    Napi::Value GetMaxPacketLifeTime(const Napi::CallbackInfo& info);
    Napi::Value GetMaxRetransmits(const Napi::CallbackInfo& info);
    Napi::Value IsReliable(const Napi::CallbackInfo& info);
    Napi::Value IsOrdered(const Napi::CallbackInfo& info);

    std::shared_ptr<twilio::media::LocalDataTrack> track_;
    std::shared_ptr<LocalDataTrackSendObserver> observer_;
    std::unique_ptr<AsyncContext> asyncContext_;
    // Keyed by the message id rtc-cpp returns from send(). Touched only on the
    // JS thread, so no lock is needed.
    std::map<uint64_t, Napi::Promise::Deferred> pendingSends_;

    // Requested values, kept because LocalDataTrack's getters narrow them to uint16_t.
    int max_packet_life_time_ = -1;
    int max_retransmits_ = -1;
};

}
