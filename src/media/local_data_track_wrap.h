#pragma once

#include <napi.h>
#include <twilio/media/media_factory.h>
#include <twilio/media/data_track.h>
#include <twilio/media/data_track_options.h>

namespace twilio_video_node {

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
    Napi::Value GetMaxPacketLifeTime(const Napi::CallbackInfo& info);
    Napi::Value GetMaxRetransmits(const Napi::CallbackInfo& info);
    Napi::Value IsReliable(const Napi::CallbackInfo& info);
    Napi::Value IsOrdered(const Napi::CallbackInfo& info);

    std::shared_ptr<twilio::media::LocalDataTrack> track_;

    // Requested values, kept because LocalDataTrack's getters narrow them to uint16_t.
    int max_packet_life_time_ = -1;
    int max_retransmits_ = -1;
};

}
