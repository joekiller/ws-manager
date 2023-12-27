import { expect, test } from '@jest/globals';
import { parseEventId } from './sample-bp-event';

test('parseEvent', () => {
  let eventId = parseEventId('658b6d08dadad90dd80dafc2');
  expect(eventId.increment).toBe(896962);
  expect(eventId.timestamp).toBe(1703636232);
  expect(eventId.session).toBe(939974528472);
  eventId = parseEventId('00000020f51bb4362eee2a4d');
  expect(eventId.increment).toBe(15608397);
  expect(eventId.timestamp).toBe(32);
  expect(eventId.session).toBe(1052731782702);
  eventId = parseEventId('507c7f79bcf86cd7994f6c0e');
  expect(eventId.timestamp).toBe(1350336377);
});
