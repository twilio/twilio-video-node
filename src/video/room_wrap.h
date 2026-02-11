#pragma once

#include <napi.h>
#include <twilio/video/video.h>
#include <twilio/video/room.h>
#include <twilio/video/connect_options.h>
#include "room_observer_wrap.h"
#include "connect_options_wrap.h"
#include "../common/async_context.h"
#include <map>

namespace twilio_video_node {

class RoomWrap : public Napi::ObjectWrap<RoomWrap> {
public:
    static void Init(Napi::Env env, Napi::Object exports);
    static Napi::Value Connect(const Napi::CallbackInfo& info);

    RoomWrap(const Napi::CallbackInfo& info);
    ~RoomWrap();

    void emitEvent(const std::string& eventName, Napi::Value arg = Napi::Value());
    twilio::video::Room* getRoom() const { return room_.get(); }

private:
    static Napi::FunctionReference constructor_;

    Napi::Value GetName(const Napi::CallbackInfo& info);
    Napi::Value GetSid(const Napi::CallbackInfo& info);
    Napi::Value GetState(const Napi::CallbackInfo& info);
    Napi::Value GetMediaRegion(const Napi::CallbackInfo& info);
    Napi::Value IsRecording(const Napi::CallbackInfo& info);
    Napi::Value GetLocalParticipant(const Napi::CallbackInfo& info);
    Napi::Value GetRemoteParticipants(const Napi::CallbackInfo& info);
    Napi::Value Disconnect(const Napi::CallbackInfo& info);
    Napi::Value On(const Napi::CallbackInfo& info);
    Napi::Value Off(const Napi::CallbackInfo& info);

    std::unique_ptr<twilio::video::Room> room_;
    std::shared_ptr<RoomObserverWrap> observer_;
    std::map<std::string, std::vector<Napi::FunctionReference>> eventListeners_;
    std::unique_ptr<AsyncContext> asyncContext_;

    // Participant wrapper cache (keyed by SID)
    std::map<std::string, Napi::ObjectReference> participantCache_;

#ifdef __APPLE__
    uv_timer_t* mainQueueTimer_ = nullptr;
#endif
};

}
