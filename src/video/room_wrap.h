#pragma once

#include <napi.h>
#include <twilio/video/video.h>
#include <twilio/video/room.h>
#include <twilio/video/connect_options.h>
#include <twilio/media/stats_observer.h>
#include <twilio/media/stats_report.h>
#include "room_observer_wrap.h"
#include "../common/async_context.h"
#include <atomic>
#include <cassert>
#include <memory>
#include <set>
#include <mutex>

namespace twilio_video_node {

class RoomWrap;

class OneShotStatsObserver;

// Holds the set of in-flight one-shot stats observers behind its own mutex.
// Lives behind a shared_ptr so an observer can erase itself on completion (from
// a WebRTC thread) even if the owning RoomWrap is being torn down concurrently
// (on the main thread): the registry and its mutex stay alive as long as either
// side still holds a reference.
class StatsObserverRegistry {
public:
    void add(const std::shared_ptr<OneShotStatsObserver>& obs);
    void remove(const std::shared_ptr<OneShotStatsObserver>& obs);
    // cancel() every pending observer and drop them. Used on Dispose/teardown.
    void cancelAll();

private:
    std::mutex mutex_;
    std::set<std::shared_ptr<OneShotStatsObserver>> observers_;
};

class OneShotStatsObserver
    : public twilio::media::StatsObserver,
      public std::enable_shared_from_this<OneShotStatsObserver> {
public:
    OneShotStatsObserver(std::shared_ptr<AsyncContext> ctx,
                         std::shared_ptr<Napi::FunctionReference> cb,
                         std::weak_ptr<StatsObserverRegistry> registry);
    ~OneShotStatsObserver() override;

    void onStats(const std::vector<twilio::media::StatsReport>& stats_reports) override;
    void cancel();

private:
    std::shared_ptr<AsyncContext> asyncContext_;
    std::shared_ptr<Napi::FunctionReference> callback_;
    std::weak_ptr<StatsObserverRegistry> registry_;
    std::atomic<bool> fired_{false};
};

class RoomWrap : public Napi::ObjectWrap<RoomWrap> {
public:
    static void Init(Napi::Env env, Napi::Object exports);
    static Napi::Value Connect(const Napi::CallbackInfo& info);

    RoomWrap(const Napi::CallbackInfo& info);
    ~RoomWrap();

    void emitEvent(const std::string& eventName, Napi::Value arg = Napi::Value());
    twilio::video::Room* getRoom() const { return room_.get(); }

    /**
     * Drops the cached wrap for a participant's SID. Call on the JS thread when
     * a participant disconnects, so a participant who leaves is not pinned in
     * memory for the rest of the Room's life. Without this, participantCache_
     * only prunes a departed participant as a side effect of a later
     * GetRemoteParticipants call; an application that never reads
     * room.participants would otherwise keep every departed participant's wrap
     * (and the native object beneath it) alive until the Room itself is
     * disposed.
     */
    void ForgetParticipantWrap(const std::string& sid);

    /**
     * Records that a participant is disconnecting and their event is still on
     * its way to the JS thread. Safe to call from any thread.
     *
     * GetRemoteParticipants prunes cached wraps for participants the Room no
     * longer lists, and rtc-cpp removes a participant before it raises the
     * disconnect. A read landing in that window would otherwise drop the last
     * reference to the wrap whose queue is carrying participantDisconnected,
     * and collecting the wrap discards the event. ForgetParticipantWrap clears
     * the record once the event has been delivered.
     */
    void MarkParticipantDisconnecting(const std::string& sid);

private:
    bool isParticipantDisconnecting(const std::string& sid);

    Napi::FunctionReference eventCallback_;
    static Napi::FunctionReference constructor_;

    Napi::Value GetName(const Napi::CallbackInfo& info);
    Napi::Value GetSid(const Napi::CallbackInfo& info);
    Napi::Value GetState(const Napi::CallbackInfo& info);
    Napi::Value GetMediaRegion(const Napi::CallbackInfo& info);
    Napi::Value IsRecording(const Napi::CallbackInfo& info);
    Napi::Value GetLocalParticipant(const Napi::CallbackInfo& info);
    Napi::Value GetDominantSpeaker(const Napi::CallbackInfo& info);
    Napi::Value GetRemoteParticipants(const Napi::CallbackInfo& info);
    Napi::Value Disconnect(const Napi::CallbackInfo& info);
    Napi::Value Dispose(const Napi::CallbackInfo& info);
    Napi::Value SetEventCallback(const Napi::CallbackInfo& info);
    Napi::Value GetStats(const Napi::CallbackInfo& info);

    std::unique_ptr<twilio::video::Room> room_;
    std::shared_ptr<RoomObserverWrap> observer_;
    std::shared_ptr<AsyncContext> asyncContext_;

    // rtc-cpp holds weak_ptr to stats observers, so we must prevent premature
    // destruction. Observers erase themselves on completion (see GetStats).
    std::shared_ptr<StatsObserverRegistry> statsObservers_ =
        std::make_shared<StatsObserverRegistry>();

    // Participant wrapper caches
    Napi::ObjectReference localParticipantCache_;
    std::map<std::string, Napi::ObjectReference> participantCache_;

    std::mutex disconnectingSidsMutex_;
    std::set<std::string> disconnectingSids_;

#ifdef __APPLE__
    uv_timer_t* mainQueueTimer_ = nullptr;
#endif
};

}
