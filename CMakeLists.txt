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

# rtc-cpp SDK paths
set(RTC_CPP_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../rtc-cpp")
set(RTC_CPP_INCLUDE "${RTC_CPP_ROOT}/include")

# Detect platform and architecture
if(APPLE)
    set(TARGET_PLATFORM "darwin")
    set(TARGET_ARCH "x86_64")
    set(BUILD_DIR "${RTC_CPP_ROOT}/build-darwin-x86_64-debug")
    set(CMAKE_OSX_ARCHITECTURES "x86_64")
else()
    set(TARGET_PLATFORM "linux")
    set(TARGET_ARCH "x86_64")
    set(BUILD_DIR "${RTC_CPP_ROOT}/build-linux-x86_64-debug")
endif()

set(BUILD_TYPE "debug")
set(THIRD_PARTY_DIR "${BUILD_DIR}/third-party")
set(WEBRTC_HOME_DIR "${THIRD_PARTY_DIR}/webrtc-full-tvi")
set(WEBRTC_INCLUDE_DIR "${WEBRTC_HOME_DIR}/include")
set(WEBRTC_LIB_DIR "${WEBRTC_HOME_DIR}/lib/${BUILD_TYPE}/${TARGET_ARCH}")

# Include directories
include_directories(
    ${RTC_CPP_INCLUDE}
    ${WEBRTC_INCLUDE_DIR}
    ${WEBRTC_INCLUDE_DIR}/webrtc
    ${WEBRTC_INCLUDE_DIR}/webrtc/third_party/abseil-cpp
    ${WEBRTC_INCLUDE_DIR}/webrtc/third_party/libyuv/include
    ${THIRD_PARTY_DIR}/boost-headers/include
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

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
)

add_library(${PROJECT_NAME} SHARED ${ADDON_SOURCES})
set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")

# Link rtc-cpp libraries
target_link_libraries(${PROJECT_NAME}
    ${BUILD_DIR}/video/src/libtwilio-video.a
    ${WEBRTC_LIB_DIR}/libwebrtc.a
    ${WEBRTC_LIB_DIR}/libjsoncpp.a
)

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
