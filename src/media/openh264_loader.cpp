#include "openh264_loader.h"
#include <wels/codec_ver.h>
#include <dlfcn.h>
#include <iterator>
#include <mutex>

namespace twilio_video_node {

namespace {
// Guards `loaded`: Node worker threads share the addon, and any of them can
// load a library or create a media factory.
std::mutex loaded_mutex;
std::optional<OpenH264Library> loaded;

// Resolves `name` into `fn`, or returns false with dlerror()'s text in `error`.
template <typename Fn>
bool Resolve(void* handle, const char* name, Fn& fn, std::string& error) {
    fn = reinterpret_cast<Fn>(dlsym(handle, name));
    if (!fn) {
        // dlsym() can return null without an error, for a symbol whose value is null.
        const char* reason = dlerror();
        error = std::string("Failed to load OpenH264: ") + (reason ? reason : std::string(name) + " is null");
        return false;
    }
    return true;
}

struct AcceptedVersion {
    unsigned int major;
    unsigned int minor;
};

// The OpenH264 releases whose API matches the vendored headers, oldest first.
// The headers are the newest release's, so its entry is last.
constexpr AcceptedVersion kAcceptedVersions[] = {{2, 7}};
constexpr AcceptedVersion kNewestAccepted = kAcceptedVersions[std::size(kAcceptedVersions) - 1];
static_assert(kNewestAccepted.major == OPENH264_MAJOR && kNewestAccepted.minor == OPENH264_MINOR,
              "The last accepted OpenH264 version must match third_party/openh264's codec_ver.h");

bool IsAccepted(const OpenH264Version& version) {
    for (const AcceptedVersion& accepted : kAcceptedVersions) {
        if (version.uMajor == accepted.major && version.uMinor == accepted.minor) {
            return true;
        }
    }
    return false;
}

// "2.7", or "2.7, 2.8" for several.
std::string AcceptedVersionList() {
    std::string list;
    for (const AcceptedVersion& accepted : kAcceptedVersions) {
        if (!list.empty()) {
            list += ", ";
        }
        list += std::to_string(accepted.major) + "." + std::to_string(accepted.minor);
    }
    return list;
}
}  // namespace

std::optional<OpenH264Library> LoadOpenH264(const std::string& path, std::string& error) {
    // Without a '/', dlopen() searches the library path instead, and could load
    // a system copy of OpenH264 rather than the file the caller named.
    std::string file = path.find('/') == std::string::npos ? "./" + path : path;

    // RTLD_NOW resolves every symbol the library needs here, so one missing
    // from this system fails now, with dlerror() naming it, instead of on the
    // library's first encode.
    void* handle = dlopen(file.c_str(), RTLD_NOW | RTLD_LOCAL);
    if (!handle) {
        error = std::string("Failed to load OpenH264: ") + dlerror();
        return std::nullopt;
    }

    OpenH264Library library{};
    OpenH264Version (*get_version)(void) = nullptr;
    if (!Resolve(handle, "WelsGetCodecVersion", get_version, error)) {
        dlclose(handle);
        return std::nullopt;
    }
    // Checked before the other entry points, so a version that renamed one
    // reports the version instead of a missing symbol.
    library.version = get_version();
    if (!IsAccepted(library.version)) {
        error = "OpenH264 " + std::to_string(library.version.uMajor) + "." +
                std::to_string(library.version.uMinor) + "." +
                std::to_string(library.version.uRevision) + " at " + path +
                " is not supported: this SDK accepts OpenH264 " + AcceptedVersionList() +
                ". A newer OpenH264 needs a newer version of this SDK.";
        dlclose(handle);
        return std::nullopt;
    }
    if (!Resolve(handle, "WelsCreateSVCEncoder", library.create_encoder, error) ||
        !Resolve(handle, "WelsDestroySVCEncoder", library.destroy_encoder, error) ||
        !Resolve(handle, "WelsCreateDecoder", library.create_decoder, error) ||
        !Resolve(handle, "WelsDestroyDecoder", library.destroy_decoder, error)) {
        dlclose(handle);
        return std::nullopt;
    }
    return library;
}

void SetLoadedOpenH264(const OpenH264Library& library) {
    std::lock_guard<std::mutex> lock(loaded_mutex);
    loaded = library;
}

std::optional<OpenH264Library> LoadedOpenH264() {
    std::lock_guard<std::mutex> lock(loaded_mutex);
    return loaded;
}

}
