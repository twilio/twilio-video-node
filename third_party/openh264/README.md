# OpenH264 headers

The public API headers of [OpenH264](https://github.com/cisco/openh264) `v2.7.0` (commit `1bca62311e447fd9c39fc93de2c4b96cd5ce971c`), copied unmodified from `codec/api/wels/`. Licensed under the BSD 2-Clause license in [LICENSE](LICENSE).

The addon compiles against these headers and loads the OpenH264 library at runtime. It accepts a library whose major and minor version is in the list of accepted versions in `src/media/openh264_loader.cpp`, whatever its revision. These headers are the newest accepted release's, so that release is the last entry in the list.

To support a new OpenH264 release, compare its `codec/api/wels/` headers with these. If only `codec_ver.h` differs, add the release to the end of the list, replace `codec_ver.h`, and update the version and commit above; this isn't a breaking change. If any other header differs, replace all four headers, check the struct layouts they declare, update the version and commit above, and make the list that release alone: dropping the older releases is a breaking change.
