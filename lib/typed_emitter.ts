import { EventEmitter } from 'node:events';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventMap = { [K in string]: (...args: any[]) => void };

export class TypedEventEmitter<Events extends EventMap> extends EventEmitter {
  override on<K extends keyof Events & string>(event: K, listener: Events[K]): this {
    return super.on(event, listener);
  }

  override once<K extends keyof Events & string>(event: K, listener: Events[K]): this {
    return super.once(event, listener);
  }

  override off<K extends keyof Events & string>(event: K, listener: Events[K]): this {
    return super.off(event, listener);
  }

  override removeListener<K extends keyof Events & string>(event: K, listener: Events[K]): this {
    return super.removeListener(event, listener);
  }

  override addListener<K extends keyof Events & string>(event: K, listener: Events[K]): this {
    return super.addListener(event, listener);
  }
}
