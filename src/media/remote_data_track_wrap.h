#pragma once

#include <napi.h>
#include <twilio/media/data_track.h>
#include "../common/async_context.h"

namespace twilio_video_node {

class RemoteDataTrackObserverImpl;

class RemoteDataTrackWrap : public Napi::ObjectWrap<RemoteDataTrackWrap> {
public:
    static void Init(Napi::Env env, Napi::Object exports);
    static Napi::Object NewInstance(Napi::Env env, std::shared_ptr<twilio::media::RemoteDataTrack> track);

    RemoteDataTrackWrap(const Napi::CallbackInfo& info);
    ~RemoteDataTrackWrap();

    std::shared_ptr<twilio::media::RemoteDataTrack> getTrack() const { return track_; }
    void onMessage(const std::string& message);
    void onBufferMessage(const uint8_t* data, size_t length);

private:
    static Napi::FunctionReference constructor_;

    Napi::Value GetName(const Napi::CallbackInfo& info);
    Napi::Value GetSid(const Napi::CallbackInfo& info);
    Napi::Value IsReliable(const Napi::CallbackInfo& info);
    Napi::Value IsOrdered(const Napi::CallbackInfo& info);
    Napi::Value OnMessage(const Napi::CallbackInfo& info);
    Napi::Value RemoveMessageCallback(const Napi::CallbackInfo& info);

    std::shared_ptr<twilio::media::RemoteDataTrack> track_;
    std::shared_ptr<RemoteDataTrackObserverImpl> observer_;
    Napi::FunctionReference messageCallback_;
    std::unique_ptr<AsyncContext> asyncContext_;
};

}
