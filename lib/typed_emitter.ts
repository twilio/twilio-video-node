import { EventEmitter } from 'node:events';

/**
 * A Node.js `EventEmitter` narrowed to a specific set of events.
 *
 * The listener methods accept only the event names declared in `Events`, and
 * infer each listener's parameters from that event's signature, so a misspelled
 * event name or a listener with the wrong arguments is a compile-time error.
 * Every other `EventEmitter` method is inherited unchanged and stays untyped.
 *
 * This class is not instantiated directly. It is the base class for {@link Room},
 * {@link LocalParticipant}, and {@link RemoteParticipant}.
 *
 * @typeParam Events - The event map this emitter accepts.
 */
export class TypedEventEmitter<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Events extends { [K in string]: (...args: any[]) => void },
> extends EventEmitter {
  /**
   * Add a listener invoked every time `event` is emitted.
   *
   * @param event - The event to listen for.
   * @param listener - Called with the event's arguments.
   * @returns This emitter, for chaining.
   */
  override on<K extends keyof Events & string>(event: K, listener: Events[K]): this {
    return super.on(event, listener);
  }

  /**
   * Add a listener invoked at most once, then removed.
   *
   * @param event - The event to listen for.
   * @param listener - Called with the event's arguments.
   * @returns This emitter, for chaining.
   */
  override once<K extends keyof Events & string>(event: K, listener: Events[K]): this {
    return super.once(event, listener);
  }

  /**
   * Remove a previously added listener. The `listener` must be the same
   * function reference that was registered.
   *
   * @param event - The event the listener was registered for.
   * @param listener - The listener to remove.
   * @returns This emitter, for chaining.
   */
  override off<K extends keyof Events & string>(event: K, listener: Events[K]): this {
    return super.off(event, listener);
  }

  /**
   * Alias for {@link TypedEventEmitter.off}.
   *
   * @param event - The event the listener was registered for.
   * @param listener - The listener to remove.
   * @returns This emitter, for chaining.
   */
  override removeListener<K extends keyof Events & string>(event: K, listener: Events[K]): this {
    return super.removeListener(event, listener);
  }

  /**
   * Alias for {@link TypedEventEmitter.on}.
   *
   * @param event - The event to listen for.
   * @param listener - Called with the event's arguments.
   * @returns This emitter, for chaining.
   */
  override addListener<K extends keyof Events & string>(event: K, listener: Events[K]): this {
    return super.addListener(event, listener);
  }
}
