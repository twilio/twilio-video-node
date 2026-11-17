// Encodes synthetic I420 frames with an OpenH264 library loaded at runtime,
// decodes them again, and checks the decoded frames against the originals.
// It exercises the loader against a real OpenH264 build, which the unit tests
// can't: the library is never committed, cached or baked into an image.
//
// Build and run on Linux x64, from the repository root:
//   g++ -std=c++17 -O2 -Isrc -Ithird_party/openh264/include test/native/openh264_roundtrip.cpp src/media/openh264_loader.cpp -ldl -o /tmp/openh264_roundtrip
//   /tmp/openh264_roundtrip /path/to/libopenh264.so
//
// Exits 0 when every frame round-trips, 1 when the round trip fails, and 2
// when the library can't be loaded (the loader's error is printed).

#include "media/openh264_loader.h"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <limits>
#include <vector>

namespace {

constexpr int kWidth = 320;
constexpr int kHeight = 240;
constexpr int kFrames = 30;
constexpr int kBitrate = 500000;
constexpr double kMinPsnr = 30.0;

struct Plane {
    int width;
    int height;
    std::vector<uint8_t> pixels;
};

struct Frame {
    Plane planes[3];
};

// Smooth patterns that move every frame, so later frames are coded as motion
// against earlier ones rather than as repeats. The motion is large enough that
// a decoder returning the previous frame falls well below kMinPsnr.
Frame MakeFrame(int n) {
    Frame frame{{{kWidth, kHeight, {}}, {kWidth / 2, kHeight / 2, {}}, {kWidth / 2, kHeight / 2, {}}}};
    for (int p = 0; p < 3; ++p) {
        Plane& plane = frame.planes[p];
        plane.pixels.resize(plane.width * plane.height);
        for (int y = 0; y < plane.height; ++y) {
            for (int x = 0; x < plane.width; ++x) {
                double value = 128 + 60 * std::sin((x + 8 * n + 40 * p) / 15.0) +
                               40 * std::cos((y - 5 * n) / 11.0);
                plane.pixels[y * plane.width + x] = static_cast<uint8_t>(value);
            }
        }
    }
    return frame;
}

double Psnr(const Plane& expected, const uint8_t* actual, int stride) {
    double squared_error = 0;
    for (int y = 0; y < expected.height; ++y) {
        for (int x = 0; x < expected.width; ++x) {
            double diff = expected.pixels[y * expected.width + x] - actual[y * stride + x];
            squared_error += diff * diff;
        }
    }
    if (squared_error == 0) return std::numeric_limits<double>::infinity();
    double mse = squared_error / (expected.width * expected.height);
    return 10 * std::log10(255.0 * 255.0 / mse);
}

ISVCEncoder* CreateEncoder(const twilio_video_node::OpenH264Library& library) {
    ISVCEncoder* encoder = nullptr;
    if (library.create_encoder(&encoder) != 0 || !encoder) return nullptr;

    SEncParamExt param;
    encoder->GetDefaultParams(&param);
    param.iUsageType = CAMERA_VIDEO_REAL_TIME;
    param.iPicWidth = kWidth;
    param.iPicHeight = kHeight;
    param.iTargetBitrate = kBitrate;
    param.iRCMode = RC_BITRATE_MODE;
    param.fMaxFrameRate = 30;
    // A skipped frame would produce no output and break the frame count.
    param.bEnableFrameSkip = false;
    param.iSpatialLayerNum = 1;
    SSpatialLayerConfig& layer = param.sSpatialLayers[0];
    layer.iVideoWidth = kWidth;
    layer.iVideoHeight = kHeight;
    layer.fFrameRate = 30;
    layer.iSpatialBitrate = kBitrate;
    layer.uiProfileIdc = PRO_BASELINE;
    layer.sSliceArgument.uiSliceMode = SM_SINGLE_SLICE;

    int format = videoFormatI420;
    if (encoder->InitializeExt(&param) != cmResultSuccess ||
        encoder->SetOption(ENCODER_OPTION_DATAFORMAT, &format) != cmResultSuccess) {
        library.destroy_encoder(encoder);
        return nullptr;
    }
    return encoder;
}

ISVCDecoder* CreateDecoder(const twilio_video_node::OpenH264Library& library) {
    ISVCDecoder* decoder = nullptr;
    if (library.create_decoder(&decoder) != 0 || !decoder) return nullptr;

    SDecodingParam param = {};
    param.sVideoProperty.eVideoBsType = VIDEO_BITSTREAM_AVC;
    if (decoder->Initialize(&param) != cmResultSuccess) {
        library.destroy_decoder(decoder);
        return nullptr;
    }
    return decoder;
}

// Encodes one frame into an Annex B access unit. Returns false on an encoder error.
bool Encode(ISVCEncoder* encoder, Frame& frame, int n, std::vector<uint8_t>& access_unit) {
    SSourcePicture picture = {};
    picture.iColorFormat = videoFormatI420;
    picture.iPicWidth = kWidth;
    picture.iPicHeight = kHeight;
    picture.uiTimeStamp = n * 33;
    for (int p = 0; p < 3; ++p) {
        picture.iStride[p] = frame.planes[p].width;
        picture.pData[p] = frame.planes[p].pixels.data();
    }

    SFrameBSInfo info = {};
    if (encoder->EncodeFrame(&picture, &info) != cmResultSuccess) return false;

    access_unit.clear();
    for (int i = 0; i < info.iLayerNum; ++i) {
        const SLayerBSInfo& layer = info.sLayerInfo[i];
        int size = 0;
        for (int nal = 0; nal < layer.iNalCount; ++nal) size += layer.pNalLengthInByte[nal];
        access_unit.insert(access_unit.end(), layer.pBsBuf, layer.pBsBuf + size);
    }
    return true;
}

int RoundTrip(const twilio_video_node::OpenH264Library& library) {
    ISVCEncoder* encoder = CreateEncoder(library);
    if (!encoder) {
        std::fprintf(stderr, "FAIL: could not create the encoder\n");
        return 1;
    }
    ISVCDecoder* decoder = CreateDecoder(library);
    if (!decoder) {
        std::fprintf(stderr, "FAIL: could not create the decoder\n");
        encoder->Uninitialize();
        library.destroy_encoder(encoder);
        return 1;
    }

    int decoded = 0;
    size_t total_bytes = 0;
    double min_psnr = std::numeric_limits<double>::infinity();
    bool ok = true;
    std::vector<uint8_t> access_unit;

    for (int n = 0; n < kFrames && ok; ++n) {
        Frame frame = MakeFrame(n);
        if (!Encode(encoder, frame, n, access_unit) || access_unit.empty()) {
            std::fprintf(stderr, "FAIL: frame %d produced no bitstream\n", n);
            ok = false;
            break;
        }
        total_bytes += access_unit.size();

        unsigned char* planes[3] = {};
        SBufferInfo buffer = {};
        DECODING_STATE state =
            decoder->DecodeFrameNoDelay(access_unit.data(), static_cast<int>(access_unit.size()), planes, &buffer);
        if (state != dsErrorFree || buffer.iBufferStatus != 1) {
            std::fprintf(stderr, "FAIL: frame %d did not decode (state 0x%x, status %d)\n", n, state,
                         buffer.iBufferStatus);
            ok = false;
            break;
        }

        const SSysMEMBuffer& out = buffer.UsrData.sSystemBuffer;
        if (out.iWidth != kWidth || out.iHeight != kHeight) {
            std::fprintf(stderr, "FAIL: frame %d decoded as %dx%d\n", n, out.iWidth, out.iHeight);
            ok = false;
            break;
        }
        // iStride[0] is the luma stride; both chroma planes use iStride[1].
        for (int p = 0; p < 3; ++p) {
            double psnr = Psnr(frame.planes[p], planes[p], out.iStride[p == 0 ? 0 : 1]);
            if (psnr < min_psnr) min_psnr = psnr;
        }
        ++decoded;
    }

    decoder->Uninitialize();
    library.destroy_decoder(decoder);
    encoder->Uninitialize();
    library.destroy_encoder(encoder);

    std::printf("frames: %d encoded and decoded of %d, %zu bytes, minimum PSNR %.1f dB\n", decoded, kFrames,
                total_bytes, min_psnr);
    if (!ok) return 1;
    if (min_psnr < kMinPsnr) {
        std::fprintf(stderr, "FAIL: minimum PSNR %.1f dB is below %.1f dB\n", min_psnr, kMinPsnr);
        return 1;
    }
    std::printf("PASS\n");
    return 0;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc != 2) {
        std::fprintf(stderr, "usage: %s /path/to/libopenh264.so\n", argv[0]);
        return 2;
    }

    std::string error;
    auto library = twilio_video_node::LoadOpenH264(argv[1], error);
    if (!library) {
        std::fprintf(stderr, "%s\n", error.c_str());
        return 2;
    }
    std::printf("loaded OpenH264 %u.%u.%u\n", library->version.uMajor, library->version.uMinor,
                library->version.uRevision);
    return RoundTrip(*library);
}
