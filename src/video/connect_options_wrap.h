#pragma once

#include <napi.h>
#include <twilio/video/connect_options.h>
#include <twilio/media/media_factory.h>
#include <twilio/media/track.h>
#include <twilio/media/data_track.h>
#include <vector>

namespace twilio_video_node {

class ConnectOptionsWrap : public Napi::ObjectWrap<ConnectOptionsWrap> {
public:
    static void Init(Napi::Env env, Napi::Object exports);

    ConnectOptionsWrap(const Napi::CallbackInfo& info);
    ~ConnectOptionsWrap();

    twilio::video::ConnectOptions build();

private:
    static Napi::FunctionReference constructor_;

    std::string accessToken_;
    std::string roomName_;
    std::shared_ptr<twilio::media::MediaFactory> mediaFactory_;
    std::vector<std::shared_ptr<twilio::media::LocalVideoTrack>> videoTracks_;
    std::vector<std::shared_ptr<twilio::media::LocalAudioTrack>> audioTracks_;
    std::vector<std::shared_ptr<twilio::media::LocalDataTrack>> dataTracks_;
    bool enableInsights_ = true;
    bool enableAutomaticSubscription_ = true;
    bool enableDominantSpeaker_ = false;
    bool enableNetworkQuality_ = false;
    std::string region_ = "gll";
    twilio::PlatformInfo platformInfo_;
};

}
