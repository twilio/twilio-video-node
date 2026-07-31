#include "napi_options.h"

namespace twilio_video_node {
namespace {

bool ThrowFieldType(Napi::Env env, const char* field, const char* expected) {
    Napi::TypeError::New(env, std::string(field) + " must be a " + expected)
        .ThrowAsJavaScriptException();
    return false;
}

}  // namespace

bool ReadOptionalString(Napi::Env env, const Napi::Object& options, const char* field,
                        std::optional<std::string>& out) {
    Napi::Value value = options.Get(field);
    if (value.IsUndefined()) return true;
    if (!value.IsString()) return ThrowFieldType(env, field, "string");
    out = value.As<Napi::String>().Utf8Value();
    return true;
}

bool ReadOptionalInt32(Napi::Env env, const Napi::Object& options, const char* field,
                       std::optional<int32_t>& out) {
    Napi::Value value = options.Get(field);
    if (value.IsUndefined() || value.IsNull()) return true;
    if (!value.IsNumber()) return ThrowFieldType(env, field, "number");
    out = value.As<Napi::Number>().Int32Value();
    return true;
}

bool ReadOptionalBool(Napi::Env env, const Napi::Object& options, const char* field,
                      std::optional<bool>& out) {
    Napi::Value value = options.Get(field);
    if (value.IsUndefined()) return true;
    if (!value.IsBoolean()) return ThrowFieldType(env, field, "boolean");
    out = value.As<Napi::Boolean>().Value();
    return true;
}

}  // namespace twilio_video_node
