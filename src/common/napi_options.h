#pragma once

#include <napi.h>
#include <cstdint>
#include <optional>
#include <string>

namespace twilio_video_node {

// Readers for optional scalar properties on a JS options object.
//
// Absent or undefined leaves `out` empty; Has() reports a key set to undefined
// as present, so it is not usable here. A wrong-typed value throws a JS
// TypeError and returns false, and the caller must return without reading
// `out`. null is wrong-typed unless noted, per the types in lib/types.ts.

bool ReadOptionalString(Napi::Env env, const Napi::Object& options, const char* field,
                        std::optional<std::string>& out);

// Also accepts null as unset: the nullable number options exist so a value read
// back off a track can be passed straight into the factory again.
bool ReadOptionalInt32(Napi::Env env, const Napi::Object& options, const char* field,
                       std::optional<int32_t>& out);

bool ReadOptionalBool(Napi::Env env, const Napi::Object& options, const char* field,
                      std::optional<bool>& out);

}  // namespace twilio_video_node
