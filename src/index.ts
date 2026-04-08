import { WebSocket, RawData, ErrorEvent, ClientOptions } from 'ws';
import { ClientRequestArgs } from 'http';
import EventEmitter from 'events';
import TypedEmitter from 'typed-emitter';

export interface WSManagerOptions {
  /** Options passed directly to the WebSocket constructor (headers, perMessageDeflate, etc.) */
  wsOptions?: ClientOptions | ClientRequestArgs;
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

type ManagerEvents = {
  messages: () => void;
  close: (code: number, reason: Buffer) => void;
  error: (err: ErrorEvent) => void;
  opened: () => void;
  /** Emitted when no messages have been received within the configured staleTimeout. */
  stale: () => void;
};

export default class WSManager<T> extends (EventEmitter as new () => TypedEmitter<ManagerEvents>) {
  static readonly DEFAULT_MAX_RETRY_TIME = 10000;
  static readonly DEFAULT_PING_TIME_OUT = 60000;

  private webSocket: WebSocket | undefined;
  shuttingDown = false;
  private pingTimeout: NodeJS.Timeout | undefined;
  private retry: NodeJS.Timeout | undefined;
  private messages: string[];
  private retryDepth = 0;
  private idleTime: number | undefined;
  private healthCheckTimer: NodeJS.Timeout | undefined;
  private staleTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly address: string,
    private readonly maxRetryTime = WSManager.DEFAULT_MAX_RETRY_TIME,
    private readonly pingTimeOut = WSManager.DEFAULT_PING_TIME_OUT,
    private readonly wsManagerOptions?: WSManagerOptions,
  ) {
    super();
    this.messages = [];
  }

  get length() {
    return this.messages.length;
  }

  shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.clearPingTimeout();
    this.stopHealthCheck();
    this.clearStaleTimer();
    this.clearRetry();

    if (!this.webSocket) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.webSocket!.on('close', () => {
        this.webSocket = undefined;
        resolve();
      });
      this.webSocket!.close(1000, 'Finished');
    });
  }

  private onClose(code: number, reason: Buffer) {
    this.clearPingTimeout();
    this.stopHealthCheck();
    this.clearStaleTimer();
    this.webSocket = undefined;
    this.emit('close', code, reason);
    if (!this.shuttingDown) {
      this.reconnect();
    }
  }

  private reconnect() {
    if (this.shuttingDown) return;
    // Clear any existing retry timer to prevent stale retries
    this.clearRetry();
    this.retry = setTimeout(() => this.connect(), this.retryTime());
  }

  private clearRetry() {
    if (this.retry) {
      clearTimeout(this.retry);
      this.retry = undefined;
    }
  }

  private retryTime() {
    const retryTime = Math.min(Math.pow(150, this.retryDepth - 1), this.maxRetryTime);
    if (retryTime !== this.maxRetryTime) {
      this.retryDepth += 1;
    }
    if (this.retryDepth === 1) {
      return 0;
    } else {
      return retryTime;
    }
  }

  private onTimeOut(): void {
    this.pingTimeout = undefined;
    const emptyTooLong = this.idleTime ? this.idleTime - Date.now() > this.pingTimeOut : false;
    if (emptyTooLong) {
      this.webSocket?.terminate();
      this.webSocket = undefined;
      this.reconnect();
    } else {
      this.onPing();
    }
  }

  private onPing() {
    this.clearPingTimeout();
    this.pingTimeout = setTimeout(() => this.onTimeOut(), this.pingTimeOut);
  }

  private clearPingTimeout() {
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
      this.pingTimeout = undefined;
    }
  }

  private onError(err: ErrorEvent) {
    this.clearPingTimeout();
    this.stopHealthCheck();
    this.clearStaleTimer();
    this.webSocket = undefined;
    this.emit('error', err);
    this.reconnect();
  }

  private onMessage(message: RawData, isBinary: boolean) {
    const wasEmptyOrIdle = this.length === 0 || this.idleTime;
    if (!isBinary) {
      this.messages.push(message.toString());
      if (this.idleTime) {
        this.idleTime = undefined; // reset the idle counter
        this.retryDepth = 0; // reset retry depth as messages are flowing
      }
      if (wasEmptyOrIdle) {
        this.emit('messages');
      }
      this.resetStaleTimer();
    }
  }

  private onOpened() {
    this.onPing();
    this.resetStaleTimer();
    this.emit('opened');
  }

  connect(): void {
    this.clearRetry();
    // Clean up previous connection properly to prevent listener leaks
    if (this.webSocket) {
      this.webSocket.removeAllListeners();
      this.webSocket.terminate();
      this.webSocket = undefined;
    }
    this.webSocket = new WebSocket(this.address, this.wsManagerOptions?.wsOptions);
    this.webSocket.on('open', () => this.onOpened());
    this.webSocket.on('error', (e: ErrorEvent) => this.onError(e));
    this.webSocket.on('close', (code, reason) => this.onClose(code, reason));
    this.webSocket.on('ping', () => this.onPing());
    this.webSocket.on('message', (data, isBinary) => this.onMessage(data, isBinary));
    this.startHealthCheck();
  }

  getMessages(): T[] {
    const lastIndex = this.messages.length;
    if (lastIndex === 0) {
      if (!this.idleTime) {
        this.idleTime = Date.now(); // we weren't idle and now we are
      }
      return [];
    } else {
      const copy = this.messages.slice(0, lastIndex);
      this.messages = this.messages.slice(lastIndex);
      return copy.map<T>((e) => <T>JSON.parse(e));
    }
  }

  // --- Health Check ---

  private startHealthCheck() {
    this.stopHealthCheck();
    const interval = this.wsManagerOptions?.healthCheckInterval;
    if (interval && interval > 0) {
      this.healthCheckTimer = setInterval(() => {
        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
          this.reconnect();
        }
      }, interval);
    }
  }

  private stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  // --- Stale Connection Detection ---

  private resetStaleTimer() {
    this.clearStaleTimer();
    const timeout = this.wsManagerOptions?.staleTimeout;
    if (timeout && timeout > 0) {
      this.staleTimer = setTimeout(() => {
        this.staleTimer = undefined;
        this.emit('stale');
      }, timeout);
    }
  }

  private clearStaleTimer() {
    if (this.staleTimer) {
      clearTimeout(this.staleTimer);
      this.staleTimer = undefined;
    }
  }
}
