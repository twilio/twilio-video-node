#pragma once

#include <napi.h>
#include <twilio/media/data_track.h>
#include "../common/async_context.h"
#include <atomic>
#include <memory>

namespace twilio_video_node {

class RemoteDataTrackObserverImpl;

class RemoteDataTrackWrap : public Napi::ObjectWrap<RemoteDataTrackWrap> {
public:
    static void Init(Napi::Env env, Napi::Object exports);

    /**
     * Builds the JS wrap for `track`, reusing whichever observer that same
     * native track already has (from a previous NewInstance call for it, such
     * as a second read of a participant's dataTracks) rather than installing a
     * new one. A native RemoteDataTrack accepts only one observer at a time, so
     * installing a second would silently cut off every wrap already registered
     * with the first, rather than adding to them. Two Rooms subscribed to the
     * same publication have separate native tracks and separate observers.
     */
    static Napi::Object NewInstance(Napi::Env env, std::shared_ptr<twilio::media::RemoteDataTrack> track);

    /**
     * Detaches and permanently closes `track`'s observer. Call once, when the
     * track is unsubscribed; no wrap can receive further messages afterward.
     */
    static void CloseObserver(std::shared_ptr<twilio::media::RemoteDataTrack> track);

    RemoteDataTrackWrap(const Napi::CallbackInfo& info);
    ~RemoteDataTrackWrap();

    std::shared_ptr<twilio::media::RemoteDataTrack> getTrack() const { return track_; }
    void onMessage(const std::string& message);
    void onBufferMessage(const uint8_t* data, size_t length);

private:
    static Napi::FunctionReference constructor_;

    Napi::Value GetName(const Napi::CallbackInfo& info);
    Napi::Value GetKind(const Napi::CallbackInfo& info);
    Napi::Value GetSid(const Napi::CallbackInfo& info);
    Napi::Value GetMaxPacketLifeTime(const Napi::CallbackInfo& info);
    Napi::Value GetMaxRetransmits(const Napi::CallbackInfo& info);
    Napi::Value IsReliable(const Napi::CallbackInfo& info);
    Napi::Value IsOrdered(const Napi::CallbackInfo& info);
    Napi::Value OnMessage(const Napi::CallbackInfo& info);
    Napi::Value RemoveMessageCallback(const Napi::CallbackInfo& info);

    std::shared_ptr<twilio::media::RemoteDataTrack> track_;
    std::shared_ptr<RemoteDataTrackObserverImpl> observer_;
    Napi::FunctionReference messageCallback_;
    std::unique_ptr<AsyncContext> asyncContext_;
    std::shared_ptr<std::atomic<bool>> alive_ = std::make_shared<std::atomic<bool>>(true);
};

}
