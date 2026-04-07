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
#include <set>
#include <mutex>

namespace twilio_video_node {

class RoomWrap;

class OneShotStatsObserver : public twilio::media::StatsObserver {
public:
    OneShotStatsObserver(std::shared_ptr<AsyncContext> ctx,
                         std::shared_ptr<Napi::FunctionReference> cb);
    ~OneShotStatsObserver() override;

    void onStats(const std::vector<twilio::media::StatsReport>& stats_reports) override;
    void cancel();

private:
    std::shared_ptr<AsyncContext> asyncContext_;
    std::shared_ptr<Napi::FunctionReference> callback_;
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

private:
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

    // rtc-cpp holds weak_ptr to stats observers, so we must prevent premature destruction
    std::mutex statsObserversMutex_;
    std::set<std::shared_ptr<twilio::media::StatsObserver>> pendingStatsObservers_;

    // Participant wrapper caches
    Napi::ObjectReference localParticipantCache_;
    std::map<std::string, Napi::ObjectReference> participantCache_;

#ifdef __APPLE__
    uv_timer_t* mainQueueTimer_ = nullptr;
#endif
};

}
