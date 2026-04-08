# Joe's WebSocket Manager
A simple interface to connect to a websocket and receive an event
when messages are pending.

The manager works by emitting a `'messages'` event as soon as messages are
within its queue. Read the messages by calling `.getMessages()` repeatedly
until no more messages are in the queue. The `'messages'` event will be
emitted again when the queue was empty and more messages have arrived.

Please remember: The `'messages'` event will only fire the first time a message
is available on the queue and will not emit again until `.getMessages()` has
been called and there are no more messages to consume. You should always call
`.getMessages()` until you get zero messages back. Once no messages are queued
you can rely on the emission of the `'messages'` event to trigger when more 
messages have arrived.

The manager is uses the NodeJS [ws] WebSockets Library.

## Installing
```bash
npm install @joekiller/ws-manager
```

## Usage
The manager will emit a `'messages'` event whenever the queue was exhausted 
and more messages are available. `manager.on('messages', fn)`

### Events
The following events are emitted from the manager.
```typescript
type ManagerEvents = {
  messages: () => void;
  close: (code: number, reason: Buffer) => void;
  error: (err: Error) => void;  // just log this or errors will trip you up
  opened: () => void;
  stale: () => void;  // no messages received within staleTimeout
};
```

### Constructor
```typescript
import WSManager, { WSManagerOptions } from '@joekiller/ws-manager';

const manager = new WSManager<T>(
  address: string,             // WebSocket URL
  maxRetryTime?: number,       // Max backoff delay in ms (default: 10000)
  pingTimeOut?: number,        // Ping/pong timeout in ms (default: 60000)
  options?: WSManagerOptions,  // Additional options (see below)
);
```

### WSManagerOptions
```typescript
interface WSManagerOptions {
  /** Options passed directly to the WebSocket constructor (headers, perMessageDeflate, etc.) */
  wsOptions?: ws.ClientOptions | ClientRequestArgs;
  /**
   * Interval in ms to check that the WebSocket connection is still in OPEN state.
   * Triggers automatic reconnection if the connection is found to be unhealthy.
   * Default: 0 (disabled). Recommended: 5000 for production use.
   */
  healthCheckInterval?: number;
  /**
   * Timeout in ms after the last received message before emitting a 'stale' event.
   * Useful for detecting zombie connections where pings work but data has stopped.
   * Default: 0 (disabled).
   */
  staleTimeout?: number;
}
```

### Example
```typescript
import WSManager from '@joekiller/ws-manager';

const webSocketManager = new WSManager<unknown>('wss://ws.backpack.tf/events');

function run() {
  let running = true
  webSocketManager.on('error', (err: ErrorEvent) => console.log(err.error, err.message, err.type));
  webSocketManager.on('messages', () => {
    const messages = webSocketManager.getMessages();
    if(messages.length > 0 && running) {
      running = false;
      const message = messages.shift();
      console.log(JSON.stringify(message, null, 2));
      webSocketManager.shutdown();
    }
  });
  // connect after setting up to receive messages
  webSocketManager.connect();
}
run();

```

### Production Example (backpack.tf)

This example shows production-hardened settings learned from running the
backpack.tf listing feed at scale:

```typescript
import WSManager from '@joekiller/ws-manager';

interface BPEvent {
  id: string;
  event: 'listing-update' | 'listing-delete';
  payload: unknown;
}

const manager = new WSManager<BPEvent[]>('wss://ws.backpack.tf/events', undefined, undefined, {
  wsOptions: {
    // Disable compression - prevents CPU sawtooth patterns under sustained load
    perMessageDeflate: false,
    headers: {
      'batch-test': 'true',
    },
  },
  // Check connection health every 5 seconds
  healthCheckInterval: 5000,
  // Detect stale connections after 30 seconds without messages
  staleTimeout: 30000,
});

manager.on('error', (err) => console.error('ws error:', err.message));
manager.on('stale', () => console.warn('Connection may be stale - no messages received'));
manager.on('opened', () => console.log('Connected'));
manager.on('close', (code, reason) => console.log(`Disconnected: ${code} ${reason}`));

manager.on('messages', () => {
  const batches = manager.getMessages();
  for (const events of batches) {
    for (const event of events) {
      // process each listing event
      console.log(`${event.event}: ${event.id}`);
    }
  }
});

manager.connect();

// Graceful shutdown - returns a Promise
process.on('SIGINT', async () => {
  await manager.shutdown();
  process.exit(0);
});
```

## Notes and Features
1. The manager will automatically reconnect to websockets with some backoff if it
keeps failing to connect.
2. The manager utilizes the WebSocket standard of Pings to detect if the line
has gone silent without a disconnect.
3. The manager allows minimal to zero polling as the consumer is always
notified as soon as more messages have arrived.
4. The manager caches all pending messages in memory for eventual consumption.
With a fast enough processor, memory consumption is not a problem. However, be
aware that this mechanism could cause heavy memory consumption if the consumer
cannot keep up with the stream.
5. I have run this engine with some other projects consuming over 66 million
messages in a row with no memory leaks or issues. It seems pretty solid.
6. WebSocket constructor options (headers, compression, etc.) can be passed
through via `wsOptions` for full control over the underlying connection.
7. Optional health checks detect connections stuck in non-OPEN states and
trigger automatic reconnection.
8. Optional stale connection detection emits a `'stale'` event when no messages
arrive within a configurable timeout - useful for catching zombie connections.
9. `shutdown()` returns a Promise that resolves when the connection is fully
closed, enabling clean graceful shutdown sequences.

## About Me
I made this in my spare time and I hope you find it useful. Look me up on
any of the following social networks:

  * [twitter: @joekiller]
  * [steam: joekiller]
  * [joekiller.com]
  * [LinkedIn: Joseph Lawson]

Please understand I will not offer any support outside GitHub issues and I
make no promises to attend to those either. Happy coding!

## End

[twitter: @joekiller]: https://twitter.com/joekiller
[steam: joekiller]: https://steamcommunity.com/id/joekiller/
[joekiller.com]: https://joekiller.com
[LinkedIn: Joseph Lawson]: https://www.linkedin.com/in/joseph-lawson
[ws]: https://github.com/websockets/ws
