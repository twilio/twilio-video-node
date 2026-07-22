cmake_minimum_required(VERSION 3.15)
project(twilio_video_sdk_node)

# default CMAKE settigs
#######################

if(NOT CMAKE_BUILD_TYPE)
   set(CMAKE_BUILD_TYPE Release CACHE STRING "Choose the type of build." FORCE)
endif()


# Build Options
###############

# | CMAKE Param           | description                                                   |
# |-----------------------+---------------------------------------------------------------|
# | CMAKE_BUILD_TYPE      | Debug/Release                                                 |
# | CMAKE_JS_INC          | path of node-js include files, set by npm upon build          |
# | CMAKE_JS_LIB          | path of node-js lib files, set by npm upon build              |
# | TWILIO_VIDEO_PKG_ROOT | when set, sets the path of downloaded Twilio-Video-Cpp binary |
# | TWILIO_VIDEO_SRC_ROOT | when set, sets the path of Twilio-Video-Cpp source            |


# CMAKE toolchain settings
##########################

if(APPLE)
   set(TARGET_PLATFORM "darwin")
   set(TARGET_ARCH "x86_64")
   set(CMAKE_OSX_ARCHITECTURES "x86_64")
else()
   set(TARGET_PLATFORM "linux")
   set(TARGET_ARCH "x86_64")
endif()

# Depencency Discovery
#################################

# node-js
set(NODEJS_INCLUDE_DIRS "")
set(NODEJS_LIBS "")
if (CMAKE_JS_INC)
   set(NODEJS_INCLUDE_DIRS ${CMAKE_JS_INC})
else()
   execute_process(
      COMMAND node -p "process.execPath.replace(/bin\\/node$/, 'include/node')"
      OUTPUT_VARIABLE NODEJS_INCLUDE_DIRS
      OUTPUT_STRIP_TRAILING_WHITESPACE)
endif()
if (CMAKE_JS_LIB)
   set(NODEJS_LIBS ${CMAKE_JS_LIB})
endif()
if (NODEJS_INCLUDE_DIRS)
   message(STATUS "Using node-js headers: ${NODEJS_INCLUDE_DIRS}")
else()
   message(FATAL_ERROR "Unable to find node-js headers")
endif()

# twilio-video (and its deps)

# set(TWILIO_VIDEO_OBJ_DIR "${TWILIO_VIDEO_SRC_ROOT}/build-${TARGET_PLATFORM}-${TARGET_ARCH}-${TWILIO_VIDEO_BUILD_TYPE_DIR}")

set(TWILIO_VIDEO_INCLUDE_DIR "")
set(TWILIO_VIDEO_LIBS "")
string(TOLOWER "${CMAKE_BUILD_TYPE}" TWILIO_VIDEO_BUILD_TYPE_DIR)
if(TWILIO_VIDEO_SRC_ROOT)
   set(TWILIO_VIDEO_OBJ_DIR "${TWILIO_VIDEO_SRC_ROOT}/cmake-build-${TWILIO_VIDEO_BUILD_TYPE_DIR}")
   set(TWILIO_VIDEO_INCLUDE_DIRS
      "${TWILIO_VIDEO_SRC_ROOT}/include"
      "${TWILIO_VIDEO_OBJ_DIR}/third-party/webrtc-full-tvi/include"
      "${TWILIO_VIDEO_OBJ_DIR}/third-party/webrtc-full-tvi/include/webrtc"
      "${TWILIO_VIDEO_OBJ_DIR}/third-party/webrtc-full-tvi/include/webrtc/third_party/abseil-cpp"
      "${TWILIO_VIDEO_OBJ_DIR}/third-party/webrtc-full-tvi/include/webrtc/third_party/libyuv/include")

   # Uncomment to capture all libs, idealy the linker should strip out unused sections (functions and data)
   # file(GLOB TWILIO_VIDEO_WEBRTC_LIBS "${TWILIO_VIDEO_OBJ_DIR}/third-party/webrtc-full-tvi/lib/${TWILIO_VIDEO_BUILD_TYPE_DIR}/${TARGET_ARCH}/*.a")
   # set(TWILIO_VIDEO_LIBS "${TWILIO_VIDEO_OBJ_DIR}/video/src/libtwilio-video.a")
   # list(APPEND TWILIO_VIDEO_LIBS ${TWILIO_VIDEO_WEBRTC_LIBS})
   # Comment out to enable the more flexable solution above
   file(GLOB TWILIO_VIDEO_WEBRTC_LIB "${TWILIO_VIDEO_OBJ_DIR}/third-party/webrtc-full-tvi/lib/${TWILIO_VIDEO_BUILD_TYPE_DIR}/${TARGET_ARCH}/libwebrtc.a")
   file(GLOB TWILIO_VIDEO_JSON_LIB "${TWILIO_VIDEO_OBJ_DIR}/third-party/webrtc-full-tvi/lib/${TWILIO_VIDEO_BUILD_TYPE_DIR}/${TARGET_ARCH}/libjsoncpp.a")
   set(TWILIO_VIDEO_LIBS "${TWILIO_VIDEO_OBJ_DIR}/video/src/libtwilio-video.a" "${TWILIO_VIDEO_WEBRTC_LIB}" "${TWILIO_VIDEO_JSON_LIB}")
   # end comment block
elseif(TWILIO_VIDEO_PKG_ROOT)
   
elseif(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/deps/twilio-video")
   set(TWILIO_VIDEO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/deps/twilio-video")
   set(TWILIO_VIDEO_INCLUDE_DIRS
      "${TWILIO_VIDEO_ROOT}/include"
      "${TWILIO_VIDEO_ROOT}/include/third_party"
      "${TWILIO_VIDEO_ROOT}/include/third_party/webrtc"
      "${TWILIO_VIDEO_ROOT}/include/third_party/webrtc/third_party/abseil-cpp"
      "${TWILIO_VIDEO_ROOT}/include/third_party/webrtc/third_party/libyuv/include")
   # Uncomment to capture all libs, idealy the linker should strip out unused sections (functions and data)
   # file(GLOB TWILIO_VIDEO_LIBS "${TWILIO_VIDEO_ROOT}/lib/${TARGET_ARCH}/*/${TWILIO_VIDEO_BUILD_TYPE_DIR}/*.a")
   # comment out to enable the more flexable solution above
   file(GLOB TWILIO_VIDEO_WEBRTC_LIB "${TWILIO_VIDEO_ROOT}/lib/${TARGET_ARCH}/*/${TWILIO_VIDEO_BUILD_TYPE_DIR}/libwebrtc.a")
   file(GLOB TWILIO_VIDEO_JSON_LIB "${TWILIO_VIDEO_ROOT}/lib/${TARGET_ARCH}/*/${TWILIO_VIDEO_BUILD_TYPE_DIR}/libjsoncpp.a")
   file(GLOB TWILIO_VIDEO_LIB "${TWILIO_VIDEO_ROOT}/lib/${TARGET_ARCH}/*/${TWILIO_VIDEO_BUILD_TYPE_DIR}/libtwilio-video.a")
   set(TWILIO_VIDEO_LIBS "${TWILIO_VIDEO_LIB}" "${TWILIO_VIDEO_WEBRTC_LIB}" "${TWILIO_VIDEO_JSON_LIB}")
   # end comment out
else()
   message(FATAL_ERROR "unable to find Twilio-Video-C++")
endif()

# build targets
###############

add_library(${PROJECT_NAME} SHARED
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
   src/sinks/video_frame_sink.cpp
   src/sinks/audio_frame_sink.cpp
   src/media/node_audio_device.cpp)

target_compile_definitions(${PROJECT_NAME} PUBLIC WEBRTC_POSIX PIC)

target_compile_options(${PROJECT_NAME} PRIVATE
   $<$<CONFIG:Release>:-O3 -fPIC -fvisibility=hidden -fomit-frame-pointer>)
target_compile_options(${PROJECT_NAME} PRIVATE
   $<$<CONFIG:Debug>:-O0 -g -fPIC -fvisibility=hidden>)

target_include_directories(${PROJECT_NAME} PRIVATE
   ${CMAKE_CURRENT_SOURCE_DIR}/src
   ${CMAKE_CURRENT_SOURCE_DIR}/node_modules/node-api-headers/include
   ${CMAKE_CURRENT_SOURCE_DIR}/node_modules/node-addon-api
   ${TWILIO_VIDEO_INCLUDE_DIRS}
   ${NODEJS_INCLUDE_DIRS})

target_link_libraries(${PROJECT_NAME} PRIVATE
   ${TWILIO_VIDEO_LIBS}
   ${NODEJS_LIBS})

set_target_properties(${PROJECT_NAME} PROPERTIES
   CXX_STANDARD 17
   CXX_STANDARD_REQUIRED ON
   PREFIX ""
   SUFFIX ".node")

if(APPLE)
   target_compile_definitions(${PROJECT_NAME} PUBLIC WEBRTC_MAC)
   target_compile_options(${PROJECT_NAME} PRIVATE -stdlib=libc++)
   target_link_libraries(${PROJECT_NAME} PRIVATE
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
      "-framework CoreGraphics")
   if (NODEJS_LIBS STREQUAL "")
      target_link_options(${PROJECT_NAME} PRIVATE "-undefined" "dynamic_lookup")
   endif()
else()
   target_compile_definitions(${PROJECT_NAME} PUBLIC WEBRTC_LINUX)
   # add compiler/linker opttions to strip unused sections
   target_compile_options(${PROJECT_NAME} PRIVATE -ffunction-sections -fdata-sections)
   target_link_options(${PROJECT_NAME} PRIVATE -Wl,--gc-sections)
   target_link_libraries(${PROJECT_NAME} PRIVATE
      pthread
      dl
      X11
      Xext
      Xdamage
      Xfixes
      Xcomposite
      Xrandr
      Xtst)
endif()
