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
  error: (err: Error) => void;
  opened: () => void;
};
```

### Example
```typescript
import WSManager from '@joekiller/ws-manager';

const webSocketManager = new WSManager<unknown>('wss://ws.backpack.tf/events');

function run() {
  let running = true
  webSocketManager.on('messages', () => {
    const messages = webSocketManager.getMessages();
    if(messages.length > 0 && running) {
      running = false;
      const message = messages.shift();
      console.log(JSON.stringify(message, null, 2));
      webSocketManager.shutdown();
    }
  });
  // connect after setting up to recieve messages
  webSocketManager.connect();
}
run();

```

## Notes and Features
1. The manager will automatically reconnect to websockets with some backoff if it
keeps failing to connect.
2. The manager utilizes the WebSocket standard of Pings to detect if the line
has gone silent without a disconnect.
3. The manager allows minimal polling to need to take place as the consumer is
always notified as soon as a message has appeared.
4. The manage caches all pending messages in memory for eventual consumption.
With a fast enough processor, memory consumption is not a problem. However, be
aware that this mechanism could cause heavy memory consumption of the consumer
cannot keep up with the stream.
5. I have run this engine with some other projects consuming over 66 million
messages in a row with no memory leaks or issues. It seems pretty solid.

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
