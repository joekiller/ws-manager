import { WebSocket, RawData, ErrorEvent } from 'ws';
import EventEmitter from 'events';
import TypedEmitter from 'typed-emitter';

type ManagerEvents = {
  messages: () => void;
  close: (code: number, reason: Buffer) => void;
  error: (err: ErrorEvent) => void;
  opened: () => void;
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

  constructor(
    private readonly address: string,
    private readonly maxRetryTime = WSManager.DEFAULT_MAX_RETRY_TIME,
    private readonly pingTimeOut = WSManager.DEFAULT_PING_TIME_OUT,
  ) {
    super();
    this.messages = [];
  }

  get length() {
    return this.messages.length;
  }

  shutdown(): void {
    this.shuttingDown = true;
    this.clearTimeout();
    this.webSocket?.close(1000, 'Finished');
  }

  private onClose(code: number, reason: Buffer) {
    this.emit('close', code, reason);
    if (!this.shuttingDown) {
      this.reconnect();
    }
  }

  private reconnect() {
    if (!this.shuttingDown && !this.retry) {
      this.retry = setTimeout(() => this.connect(), this.retryTime());
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
      this.reconnect();
    } else {
      this.onPing();
    }
  }

  private onPing() {
    this.clearTimeout();
    this.pingTimeout = setTimeout(() => this.onTimeOut(), this.pingTimeOut);
  }

  private clearTimeout() {
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
    }
  }

  private onError(err: ErrorEvent) {
    this.clearTimeout();
    this.emit('error', err);
    this.reconnect();
  }

  private onMessage(message: RawData, isBinary: boolean) {
    const wasEmptyOrIdle = this.length === 0 || this.idleTime;
    if (!isBinary) {
      this.messages.push(message.toString());
      if (this.idleTime) {
        this.idleTime = undefined; // reset the idle counter
        this.retryDepth = 0; // reset and retry depth as messages are flowing
      }
      if (wasEmptyOrIdle) {
        this.emit('messages');
      }
    }
  }

  private onOpened() {
    this.onPing();
    this.emit('opened');
  }

  connect(): void {
    this.retry = undefined;
    this.webSocket?.terminate();
    this.webSocket = new WebSocket(this.address);
    this.webSocket.on('open', () => this.onOpened());
    this.webSocket.on('error', (e: ErrorEvent) => this.onError(e));
    this.webSocket.on('close', (code, reason) => this.onClose(code, reason));
    this.webSocket.on('ping', () => this.onPing());
    this.webSocket.on('message', (data, isBinary) => this.onMessage(data, isBinary));
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
}
