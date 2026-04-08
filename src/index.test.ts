import { describe, expect, test, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
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
    void manager.shutdown();
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
    await manager.shutdown();
    expect(manager.shuttingDown).toBeTruthy();
    const result = await closed;
    expect(result.code).toBe(1000);
    expect(result.reason.toString()).toBe('Finished');
  });
});

describe('websocket options', () => {
  let wss: ws.WebSocketServer;

  beforeEach(() => {
    wss = new ws.WebSocketServer({ port: 8081 });
  });

  afterEach(() => {
    wss.close();
  });

  test('passes custom headers to websocket connection', async () => {
    const receivedHeaders = new Promise<Record<string, string | string[] | undefined>>((resolve) => {
      wss.on('connection', (_ws, req) => {
        resolve(req.headers);
      });
    });

    const manager = new WSManager<TestMessage>('ws://localhost:8081', undefined, undefined, {
      wsOptions: {
        headers: {
          'x-custom-header': 'test-value',
          'x-batch-test': 'true',
        },
      },
    });
    manager.on('error', () => {
      /* suppress */
    });

    const opened = new Promise<void>((resolve) => {
      manager.on('opened', () => resolve());
    });

    manager.connect();
    await opened;

    const headers = await receivedHeaders;
    expect(headers['x-custom-header']).toBe('test-value');
    expect(headers['x-batch-test']).toBe('true');
    await manager.shutdown();
  });

  test('passes perMessageDeflate option', async () => {
    // Just verify the manager connects successfully with perMessageDeflate disabled
    const manager = new WSManager<TestMessage>('ws://localhost:8081', undefined, undefined, {
      wsOptions: {
        perMessageDeflate: false,
      },
    });
    manager.on('error', () => {
      /* suppress */
    });

    const opened = new Promise<void>((resolve) => {
      manager.on('opened', () => resolve());
    });

    wss.on('connection', (ws) => {
      ws.send(JSON.stringify({ message: 'hello' }));
    });

    manager.connect();
    await opened;
    await manager.shutdown();
  });
});

describe('connection lifecycle', () => {
  let wss: ws.WebSocketServer;

  beforeEach(() => {
    wss = new ws.WebSocketServer({ port: 8082 });
  });

  afterEach(() => {
    wss.close();
  });

  test('shutdown returns a promise that resolves on close', async () => {
    const manager = new WSManager<TestMessage>('ws://localhost:8082');
    manager.on('error', () => {
      /* suppress */
    });

    const opened = new Promise<void>((resolve) => {
      manager.on('opened', () => resolve());
    });

    manager.connect();
    await opened;

    // shutdown() should return a promise
    const shutdownPromise = manager.shutdown();
    expect(shutdownPromise).toBeInstanceOf(Promise);
    await shutdownPromise;
    expect(manager.shuttingDown).toBeTruthy();
  });

  test('shutdown resolves immediately when no connection exists', async () => {
    const manager = new WSManager<TestMessage>('ws://localhost:8082');
    manager.shuttingDown = false;
    // Never connected - shutdown should resolve immediately
    await manager.shutdown();
    expect(manager.shuttingDown).toBeTruthy();
  });

  test('reconnects automatically after server-initiated close', async () => {
    const manager = new WSManager<TestMessage>('ws://localhost:8082');
    manager.on('error', () => {
      /* suppress */
    });

    let connectionCount = 0;
    const secondConnection = new Promise<void>((resolve) => {
      wss.on('connection', (ws) => {
        connectionCount++;
        if (connectionCount === 1) {
          // Close from server side after first connection
          ws.close();
        } else if (connectionCount === 2) {
          resolve();
        }
      });
    });

    manager.connect();
    await secondConnection;
    expect(connectionCount).toBe(2);
    await manager.shutdown();
  });
});

describe('health check', () => {
  let wss: ws.WebSocketServer;

  beforeEach(() => {
    wss = new ws.WebSocketServer({ port: 8083 });
  });

  afterEach(() => {
    wss.close();
  });

  test('health check triggers reconnect when connection is unhealthy', async () => {
    const manager = new WSManager<TestMessage>('ws://localhost:8083', undefined, undefined, {
      healthCheckInterval: 100, // Check every 100ms for testing
    });
    manager.on('error', () => {
      /* suppress */
    });

    let connectionCount = 0;
    const secondConnection = new Promise<void>((resolve) => {
      wss.on('connection', (clientWs) => {
        connectionCount++;
        if (connectionCount === 1) {
          // Forcefully terminate without close frame to simulate network failure
          clientWs.terminate();
        } else if (connectionCount === 2) {
          resolve();
        }
      });
    });

    manager.connect();
    await secondConnection;
    expect(connectionCount).toBeGreaterThanOrEqual(2);
    await manager.shutdown();
  });
});

describe('stale connection detection', () => {
  let wss: ws.WebSocketServer;

  beforeEach(() => {
    wss = new ws.WebSocketServer({ port: 8084 });
  });

  afterEach(() => {
    wss.close();
  });

  test('emits stale event when no messages received within timeout', async () => {
    const manager = new WSManager<TestMessage>('ws://localhost:8084', undefined, undefined, {
      staleTimeout: 200, // 200ms for testing
    });
    manager.on('error', () => {
      /* suppress */
    });

    const staleEvent = new Promise<void>((resolve) => {
      manager.on('stale', () => resolve());
    });

    const opened = new Promise<void>((resolve) => {
      manager.on('opened', () => resolve());
    });

    manager.connect();
    await opened;

    // Don't send any messages - should trigger stale event
    await staleEvent;
    await manager.shutdown();
  });

  test('stale timer resets when messages arrive', async () => {
    const manager = new WSManager<TestMessage>('ws://localhost:8084', undefined, undefined, {
      staleTimeout: 300, // 300ms for testing
    });
    manager.on('error', () => {
      /* suppress */
    });

    let staleCount = 0;
    manager.on('stale', () => {
      staleCount++;
    });

    const messagesReceived = new Promise<void>((resolve) => {
      manager.on('messages', () => resolve());
    });

    wss.on('connection', (clientWs) => {
      // Send a message at 100ms - this should reset the 300ms stale timer
      setTimeout(() => {
        clientWs.send(JSON.stringify({ message: 'keepalive' }));
      }, 100);
    });

    manager.connect();
    await messagesReceived;

    // Wait 200ms after the message - stale timer should NOT have fired yet
    // (it was reset by the message at 100ms, so it won't fire until 100+300=400ms)
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(staleCount).toBe(0);

    await manager.shutdown();
  });
});
