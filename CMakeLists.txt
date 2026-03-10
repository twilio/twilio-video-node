cmake_minimum_required(VERSION 3.15)
project(twilio_video_sdk_node)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Get Node.js include paths
if(DEFINED CMAKE_JS_INC)
    # cmake-js provides these
    include_directories(${CMAKE_JS_INC})
else()
    # Manual Node.js headers for CLion/IDE builds
    execute_process(
        COMMAND node -p "process.execPath.replace(/bin\\/node$/, 'include/node')"
        OUTPUT_VARIABLE NODE_INCLUDE_DIR
        OUTPUT_STRIP_TRAILING_WHITESPACE
    )
    include_directories(${NODE_INCLUDE_DIR})
endif()

# node-addon-api headers
include_directories("${CMAKE_CURRENT_SOURCE_DIR}/node_modules/node-addon-api")

# Build type configuration (release by default)
if(NOT DEFINED RTC_CPP_BUILD_TYPE)
    set(RTC_CPP_BUILD_TYPE "debug")
endif()
set(BUILD_TYPE "${RTC_CPP_BUILD_TYPE}")

# Detect platform and architecture
if(APPLE)
    set(TARGET_PLATFORM "darwin")
    set(TARGET_ARCH "x86_64")
    set(CMAKE_OSX_ARCHITECTURES "x86_64")
else()
    set(TARGET_PLATFORM "linux")
    set(TARGET_ARCH "x86_64")
endif()

# Dual-mode dependency resolution
if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../rtc-cpp")
    set(RTC_CPP_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../rtc-cpp")
    set(RTC_CPP_INCLUDE "${RTC_CPP_ROOT}/include")
    set(BUILD_DIR "${RTC_CPP_ROOT}/build-${TARGET_PLATFORM}-${TARGET_ARCH}-${RTC_CPP_BUILD_TYPE}")

    if(NOT EXISTS "${BUILD_DIR}")
        message(FATAL_ERROR
            "rtc-cpp build directory not found: ${BUILD_DIR}\n"
            "\n"
            "Build rtc-cpp first:\n"
            "  cd ../rtc-cpp\n"
            "  mkdir -p build-${TARGET_PLATFORM}-${TARGET_ARCH}-${RTC_CPP_BUILD_TYPE}\n"
            "  cd build-${TARGET_PLATFORM}-${TARGET_ARCH}-${RTC_CPP_BUILD_TYPE}\n"
            "  cmake .. -DCMAKE_BUILD_TYPE=${RTC_CPP_BUILD_TYPE}\n"
            "  make -j8\n"
            "\n"
            "Or use the existing debug build:\n"
            "  RTC_CPP_BUILD_TYPE=debug npm run prebuild")
    endif()

    set(THIRD_PARTY_DIR "${BUILD_DIR}/third-party")
    message(STATUS "Using local rtc-cpp at ${RTC_CPP_ROOT} (${RTC_CPP_BUILD_TYPE})")
elseif(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/deps/twilio-video")
    # Artifact layout from Artifactory video-package
    set(DEPS_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/deps/twilio-video")
    set(RTC_CPP_INCLUDE "${DEPS_ROOT}/include")
    set(WEBRTC_INCLUDE_DIR "${DEPS_ROOT}/include/third_party/webrtc")

    # Detect compiler subdirectory (e.g. appleclang-17.0, gcc-13)
    file(GLOB COMPILER_DIRS LIST_DIRECTORIES true "${DEPS_ROOT}/lib/${TARGET_ARCH}/*")
    list(FILTER COMPILER_DIRS EXCLUDE REGEX "DS_Store")
    list(GET COMPILER_DIRS 0 COMPILER_DIR)
    set(DEPS_LIB_DIR "${COMPILER_DIR}/${BUILD_TYPE}")
    message(STATUS "Using downloaded rtc-cpp artifacts from deps/twilio-video (${BUILD_TYPE})")
    message(STATUS "  Libraries: ${DEPS_LIB_DIR}")
else()
    message(FATAL_ERROR
        "No rtc-cpp found. Either:\n"
        "  1. Checkout rtc-cpp at ../rtc-cpp and build it\n"
        "  2. Run 'node scripts/fetch-deps.js' to download artifacts")
endif()

# Resolve include and library paths per mode
if(DEFINED DEPS_ROOT)
    # Artifact mode: headers under deps/twilio-video/include/third_party/webrtc/
    # rtc-cpp includes use "webrtc/" prefix, so we add the parent dir
    include_directories(
        ${RTC_CPP_INCLUDE}
        ${DEPS_ROOT}/include/third_party
        ${WEBRTC_INCLUDE_DIR}
        ${WEBRTC_INCLUDE_DIR}/third_party/abseil-cpp
        ${WEBRTC_INCLUDE_DIR}/third_party/libyuv/include
        ${CMAKE_CURRENT_SOURCE_DIR}/src
    )
else()
    # Source checkout mode: original layout
    set(WEBRTC_HOME_DIR "${THIRD_PARTY_DIR}/webrtc-full-tvi")
    set(WEBRTC_INCLUDE_DIR "${WEBRTC_HOME_DIR}/include")
    set(WEBRTC_LIB_DIR "${WEBRTC_HOME_DIR}/lib/${BUILD_TYPE}/${TARGET_ARCH}")
    include_directories(
        ${RTC_CPP_INCLUDE}
        ${WEBRTC_INCLUDE_DIR}
        ${WEBRTC_INCLUDE_DIR}/webrtc
        ${WEBRTC_INCLUDE_DIR}/webrtc/third_party/abseil-cpp
        ${WEBRTC_INCLUDE_DIR}/webrtc/third_party/libyuv/include
        ${THIRD_PARTY_DIR}/boost-headers/include
        ${CMAKE_CURRENT_SOURCE_DIR}/src
    )
endif()

# Compiler flags matching rtc-cpp
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fPIC -DPIC -DWEBRTC_POSIX -fvisibility=hidden")
if(APPLE)
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -DWEBRTC_MAC -stdlib=libc++")
else()
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -DWEBRTC_LINUX")
endif()

# Node addon sources
set(ADDON_SOURCES
    src/addon.cpp
    src/common/error.cpp
    src/common/async_context.cpp
    src/media/media_factory_wrap.cpp
    src/media/local_video_track_wrap.cpp
    src/media/local_audio_track_wrap.cpp
    src/media/remote_video_track_wrap.cpp
    src/media/remote_audio_track_wrap.cpp
    src/media/local_data_track_wrap.cpp
    src/media/remote_data_track_wrap.cpp
    src/video/room_wrap.cpp
    src/video/room_observer_wrap.cpp
    src/video/local_participant_wrap.cpp
    src/video/remote_participant_wrap.cpp
    src/video/connect_options_wrap.cpp
    src/sinks/video_frame_sink.cpp
    src/sinks/audio_frame_sink.cpp
    src/media/node_audio_device.cpp
)

add_library(${PROJECT_NAME} SHARED ${ADDON_SOURCES})
set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")

# Link rtc-cpp libraries
if(DEFINED DEPS_ROOT)
    target_link_libraries(${PROJECT_NAME}
        ${DEPS_LIB_DIR}/libtwilio-video.a
        ${DEPS_LIB_DIR}/libwebrtc.a
        ${DEPS_LIB_DIR}/libjsoncpp.a
    )
else()
    target_link_libraries(${PROJECT_NAME}
        ${BUILD_DIR}/video/src/libtwilio-video.a
        ${WEBRTC_LIB_DIR}/libwebrtc.a
        ${WEBRTC_LIB_DIR}/libjsoncpp.a
    )
endif()

if(DEFINED CMAKE_JS_LIB)
    target_link_libraries(${PROJECT_NAME} ${CMAKE_JS_LIB})
endif()

if(APPLE)
    target_link_libraries(${PROJECT_NAME}
        "-framework CoreFoundation"
        "-framework CoreAudio"
        "-framework AudioToolbox"
        "-framework CoreMedia"
        "-framework CoreVideo"
        "-framework VideoToolbox"
        "-framework AVFoundation"
        "-framework Foundation"
        "-framework SystemConfiguration"
        "-framework Security"
        "-framework CoreGraphics"
    )
    # Allow undefined symbols for N-API (provided by Node.js runtime)
    if(NOT DEFINED CMAKE_JS_LIB)
        target_link_options(${PROJECT_NAME} PRIVATE "-undefined" "dynamic_lookup")
    endif()
else()
    target_link_libraries(${PROJECT_NAME}
        pthread
        dl
        X11
        Xext
        Xdamage
        Xfixes
        Xcomposite
        Xrandr
        Xtst
    )
endif()
