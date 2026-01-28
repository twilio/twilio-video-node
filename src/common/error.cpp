#include "error.h"

namespace twilio_video_node {

Napi::Error createTwilioError(Napi::Env env, int code, const std::string& message) {
    auto error = Napi::Error::New(env, message);
    error.Set("code", Napi::Number::New(env, code));
    return error;
}

Napi::Object createTwilioErrorObject(Napi::Env env, int code, const std::string& message) {
    auto obj = Napi::Object::New(env);
    obj.Set("code", Napi::Number::New(env, code));
    obj.Set("message", Napi::String::New(env, message));
    return obj;
}

}
