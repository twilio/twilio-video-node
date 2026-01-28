#pragma once

#include <dispatch/dispatch.h>

namespace twilio_video_node {

/**
 * Creates a custom background dispatch queue for rtc-cpp NotifierQueue.
 *
 * The default NotifierQueue uses dispatch_get_main_queue(), but Node.js
 * doesn't process the macOS main queue - it uses libuv.
 *
 * Solution: Provide a custom serial dispatch queue. rtc-cpp will post
 * observer callbacks to this queue, which WILL execute (unlike main queue).
 * Our RoomObserverWrap methods run on this queue's thread and dispatch
 * to Node.js via AsyncContext.
 */
class NotifierBridge {
public:
    /**
     * Create a serial background dispatch queue for rtc-cpp.
     * Callbacks posted to this queue WILL execute on a background thread.
     */
    static dispatch_queue_t CreateQueue() {
        return dispatch_queue_create("com.twilio.video.notifier", DISPATCH_QUEUE_SERIAL);
    }

    /**
     * Release the dispatch queue when done.
     */
    static void ReleaseQueue(dispatch_queue_t queue) {
        if (queue) {
            dispatch_release(queue);
        }
    }

private:
    NotifierBridge() = delete;
};

}
