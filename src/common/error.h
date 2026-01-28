#pragma once

#include <napi.h>
#include <string>

namespace twilio_video_node {

Napi::Error createTwilioError(Napi::Env env, int code, const std::string& message);
Napi::Object createTwilioErrorObject(Napi::Env env, int code, const std::string& message);

}
