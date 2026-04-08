import WSManager from '../src/index';
import * as fsp from 'fs/promises';
import * as os from 'os';

/**
 * Fired whenever a listing is created or updated. The exception to this is whenever listings are bumped, or when currency values are updated from a price suggestion (this causes all listings to have their value recalculated).
 *
 * Re-publishing an archived listing is considered an update.
 */
type listingUpdate = 'listing-update';

/**
 * Fired whenever a listing is deleted. Moving a listing to the archive is also considered to be deleting the listing.
 */
type listingDelete = 'listing-delete';
interface BPEvent {
  /**
   * Each event has a unique 12-byte alphanumeric ID. The first four bytes of the ID is a 32-bit timestamp. {@link https://www.mongodb.com/docs/manual/reference/method/ObjectId/ Check here} for more information on this format.
   */
  id: string;
  event: listingUpdate | listingDelete;
  payload: unknown;
}

export const parseEventId = (
  eventId: string,
): { timestamp: number; timeDate: Date; session: number; increment: number } => {
  const rawEventId = Buffer.from(eventId, 'hex');
  const timestamp = rawEventId.readUInt32BE(0);
  let session = 0;
  for (let i = 0; i < 5; i++) {
    session += rawEventId[8 - i] * Math.pow(256, i);
  }
  let increment = 0;
  for (let i = 0; i < 3; i++) {
    increment = (increment << 8) | rawEventId[9 + i];
  }
  return {
    timestamp,
    timeDate: new Date(timestamp * 1000),
    session,
    increment,
  };
};

// Production-grade backpack.tf WebSocket consumer using WSManagerOptions.
//
// Key lessons from running this feed at scale:
//   1. Disable perMessageDeflate to avoid CPU sawtooth patterns under load.
//   2. Use healthCheckInterval to catch connections stuck in non-OPEN states.
//   3. Use staleTimeout to detect zombie connections where pings work but
//      the server has stopped sending listing data.
//   4. Custom headers (e.g. batch-test) enable server-side features.
const manager = new WSManager<BPEvent[]>('wss://ws.backpack.tf/events', undefined, undefined, {
  wsOptions: {
    perMessageDeflate: false,
    headers: {
      'batch-test': 'true',
    },
  },
  healthCheckInterval: 5000,
  staleTimeout: 30000,
});

manager.on('error', (err) => {
  console.error('ws error:', err.message);
});

manager.on('stale', () => {
  console.warn('No messages received recently - connection may be stale');
});

manager.on('opened', () => {
  console.log('Connected to backpack.tf WebSocket');
});

manager.on('close', (code, reason) => {
  console.log(`Disconnected: code=${code} reason=${reason.toString()}`);
});

const run = async () => {
  manager.connect();
  while (manager.length < 10) {
    await new Promise((resolve) => setTimeout(() => resolve(undefined), 100));
  }
  const events = manager.getMessages();
  const eventBatch = events[0];
  console.log('Sample Event:');
  console.log(JSON.stringify(eventBatch, undefined, 2));
  for (const e of eventBatch) {
    const parsed = parseEventId(e.id);
    console.log(
      `session: ${parsed.session} inc: ${parsed.increment} time: ${
        parsed.timestamp
      } date: ${parsed.timeDate.toString()}`,
    );
  }
  const file = await fsp.open('events.jsonl', 'w');
  for (const e of events) {
    await file.appendFile(JSON.stringify(e) + os.EOL, { encoding: 'utf8' });
  }
  await file.close();
  // Await shutdown to ensure clean disconnection
  await manager.shutdown();
  console.log('Shutdown complete');
};

run().catch((e) => console.error(e));
