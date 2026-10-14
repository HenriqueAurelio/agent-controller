import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export interface HookMessage {
  sessionId: string;
  /** Which integration called agentctl: `claude-hook`, `codex-hook`, `codex-notify`. */
  source: string;
  payload: unknown;
}

export interface HookServerOptions {
  socketPath: string;
  /** Messages for unknown sessions are dropped without an answer. */
  isKnownSession: (id: string) => boolean;
}

const MAX_MESSAGE_BYTES = 256 * 1024;
const CONNECTION_TIMEOUT_MS = 3000;

/**
 * Endpoint for the hook server, reachable only by the current user. The name is random per run:
 * sessions learn it through `AGENTCTL_SOCKET`.
 */
export function createSocketPath(): string {
  const token = randomBytes(8).toString('hex');
  if (process.platform === 'win32') {
    // Pipes created by Node grant write access only to the owner, SYSTEM and administrators.
    return `\\\\.\\pipe\\agent-controller-${token}`;
  }
  const base = process.env.XDG_RUNTIME_DIR || os.tmpdir();
  const dir = path.join(base, `agent-controller-${os.userInfo().uid}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return path.join(dir, `hooks-${token}.sock`);
}

export function parseHookMessage(text: string): HookMessage | null {
  const line = text.split('\n', 1)[0]?.trim();
  if (!line) return null;
  try {
    const data: unknown = JSON.parse(line);
    if (!data || typeof data !== 'object') return null;
    const { v, session, source, payload } = data as Record<string, unknown>;
    if (v !== 1 || typeof session !== 'string' || typeof source !== 'string') return null;
    if (!/^[\w-]{1,64}$/.test(session) || !/^[\w-]{1,32}$/.test(source)) return null;
    return { sessionId: session, source, payload: payload ?? null };
  } catch {
    return null;
  }
}

export class HookServer extends EventEmitter<{ message: [HookMessage] }> {
  private server: net.Server | null = null;
  readonly socketPath: string;

  constructor(private readonly options: HookServerOptions) {
    super();
    this.socketPath = options.socketPath;
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
      const server = net.createServer((socket) => this.handle(socket));
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

  private handle(socket: net.Socket): void {
    const chunks: Buffer[] = [];
    let size = 0;
    socket.setTimeout(CONNECTION_TIMEOUT_MS, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_MESSAGE_BYTES) {
        socket.destroy();
        return;
      }
      chunks.push(chunk);
    });
    socket.on('end', () => {
      socket.end();
      const message = parseHookMessage(Buffer.concat(chunks).toString('utf8'));
      if (!message || !this.options.isKnownSession(message.sessionId)) return;
      this.emit('message', message);
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      const server = this.server;
      this.server = null;
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
