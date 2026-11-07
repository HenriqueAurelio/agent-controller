import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import { parseControlRequest, type ControlRequest, type ControlResponse } from './protocol';

export interface ControlServerOptions {
  socketPath: string;
  /** The secret every request carries; it is in the discovery file, readable only by the user. */
  token?: string;
  /** `signal` aborts when the caller goes away (a `wait` given up with Ctrl+C). */
  handle(request: ControlRequest, signal: AbortSignal): Promise<unknown>;
  /** The words of an error for the person at the command line, in their language. */
  describeError(err: unknown): string;
}

const MAX_REQUEST_BYTES = 256 * 1024;
/** Time to send the request; the answer of `wait` may take much longer. */
const REQUEST_TIMEOUT_MS = 3000;

/**
 * The endpoint of the `aurelium` command line: a socket (a named pipe on Windows) reachable only by
 * the current user, plus a token, so that a process that only guesses the name gets nothing.
 */
export class ControlServer {
  private server: net.Server | null = null;
  private readonly sockets = new Set<net.Socket>();
  readonly socketPath: string;
  readonly token: string;

  constructor(private readonly options: ControlServerOptions) {
    this.socketPath = options.socketPath;
    this.token = options.token ?? randomBytes(24).toString('hex');
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (process.platform !== 'win32') {
        try {
          fs.unlinkSync(this.socketPath);
        } catch {
          // No stale socket.
        }
      }
      const server = net.createServer((socket) => this.accept(socket));
      server.once('error', reject);
      server.listen(this.socketPath, () => {
        server.off('error', reject);
        server.on('error', () => {});
        if (process.platform !== 'win32') fs.chmodSync(this.socketPath, 0o600);
        this.server = server;
        resolve();
      });
    });
  }

  private accept(socket: net.Socket): void {
    this.sockets.add(socket);
    const gone = new AbortController();
    socket.on('close', () => {
      this.sockets.delete(socket);
      gone.abort();
    });
    socket.on('error', () => socket.destroy());
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const timer = setTimeout(() => socket.destroy(), REQUEST_TIMEOUT_MS);
    const answer = (response: ControlResponse) => {
      if (!socket.destroyed) socket.end(JSON.stringify(response) + '\n');
    };
    const take = () => {
      if (done) return;
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.includes('\n') && !socket.readableEnded) return;
      done = true;
      clearTimeout(timer);
      const request = parseControlRequest(text);
      if (!request || !this.validToken(request.token)) {
        answer({ ok: false, error: 'refused' });
        return;
      }
      this.options.handle(request, gone.signal).then(
        (data) => answer({ ok: true, data: data ?? null }),
        (err: unknown) => answer({ ok: false, error: this.options.describeError(err) }),
      );
    };
    socket.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        socket.destroy();
        return;
      }
      chunks.push(chunk);
      take();
    });
    socket.on('end', take);
  }

  private validToken(token: string): boolean {
    const a = Buffer.from(token);
    const b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      const server = this.server;
      this.server = null;
      for (const socket of this.sockets) socket.destroy();
      if (!server) return resolve();
      server.close(() => {
        if (process.platform !== 'win32') {
          try {
            fs.unlinkSync(this.socketPath);
          } catch {
            // Already removed by the server.
          }
        }
        resolve();
      });
    });
  }
}
