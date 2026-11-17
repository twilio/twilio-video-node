#pragma once

#include <wels/codec_api.h>
#include <optional>
#include <string>

namespace twilio_video_node {

// Entry points of a loaded OpenH264 library. The library stays loaded for the
// life of the process, so these pointers never dangle.
struct OpenH264Library {
    OpenH264Version version;
    int (*create_encoder)(ISVCEncoder** encoder);
    void (*destroy_encoder)(ISVCEncoder* encoder);
    long (*create_decoder)(ISVCDecoder** decoder);
    void (*destroy_decoder)(ISVCDecoder* decoder);
};

// Loads the OpenH264 library at `path` and resolves its entry points. Accepts
// only the major.minor of the headers in third_party/openh264, because the
// structs the encoder passes by pointer can change size between minor
// releases. A path without a '/' is taken relative to the working directory.
// On failure returns nullopt, closes the library again, and sets `error`, which
// includes the dlerror() text when the dynamic loader failed.
std::optional<OpenH264Library> LoadOpenH264(const std::string& path, std::string& error);

// Records `library` as the process's OpenH264 library. Media factories created
// afterwards use it; existing ones keep the codecs they started with. A later
// call replaces it.
void SetLoadedOpenH264(const OpenH264Library& library);

// The library last passed to SetLoadedOpenH264, or nullopt if none.
std::optional<OpenH264Library> LoadedOpenH264();

}
