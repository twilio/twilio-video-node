#pragma once

#include <napi.h>
#include <twilio/media/media_factory.h>
#include "../common/async_context.h"

namespace twilio_video_node {

class MediaFactoryWrap : public Napi::ObjectWrap<MediaFactoryWrap> {
public:
    static void Init(Napi::Env env, Napi::Object exports);
    static Napi::Object NewInstance(Napi::Env env, std::shared_ptr<twilio::media::MediaFactory> factory);

    MediaFactoryWrap(const Napi::CallbackInfo& info);
    ~MediaFactoryWrap();

    std::shared_ptr<twilio::media::MediaFactory> getFactory() const { return factory_; }

private:
    static Napi::FunctionReference constructor_;

    Napi::Value CreateVideoTrack(const Napi::CallbackInfo& info);
    Napi::Value CreateAudioTrack(const Napi::CallbackInfo& info);
    Napi::Value CreateDataTrack(const Napi::CallbackInfo& info);

    std::shared_ptr<twilio::media::MediaFactory> factory_;
    std::unique_ptr<AsyncContext> asyncContext_;
};

}
