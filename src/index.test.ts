import { describe, expect, test, beforeAll, afterAll } from '@jest/globals';
import ws from 'ws';
import WSManager from './index';

interface TestMessage {
  message: string;
}

describe('it uses a websocket', () => {
  let wss: ws.WebSocketServer;
  let manager: WSManager<TestMessage>;
  beforeAll(() => {
    wss = new ws.WebSocketServer({ port: 8080 });
    manager = new WSManager<TestMessage>('ws://localhost:8080');
    manager.on('close', (code, reason) => {
      console.debug(`closed: code: ${code}, message: ${reason.toString()}`);
    });
    manager.on('error', (err) => {
      console.error(err);
    });
    manager.on('opened', () => {
      console.log('opened socket');
    });
  });
  afterAll(() => {
    wss.close();
    manager.shutdown();
  });

  test('something', async () => {
    expect(manager).toHaveLength(0);
    expect(manager.shuttingDown).toBeFalsy();
    const testMessage = { message: 'test' };
    const pendingMessage = new Promise((resolve) => {
      manager.on('messages', () => {
        resolve(undefined);
      });
    });
    const closed: Promise<{ code: number; reason: Buffer }> = new Promise((resolve) => {
      wss.on('connection', function connection(ws) {
        ws.on('close', (code, reason) => {
          resolve({ code: code, reason });
        });
        ws.send(JSON.stringify(testMessage));
      });
    });
    manager.connect();
    await pendingMessage;
    expect(manager).toHaveLength(1);
    expect(manager.getMessages()).toEqual([testMessage]);
    expect(manager).toHaveLength(0);
    manager.shutdown();
    expect(manager.shuttingDown).toBeTruthy();
    const result = await closed;
    expect(result.code).toBe(1000);
    expect(result.reason.toString()).toBe('Finished');
  });
});
