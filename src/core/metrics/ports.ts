// The TCP ports each process listens on: `netstat -ano` on Windows; on Linux, `/proc` (which is
// always there, unlike `ss`), with `ss -ltnpH` when `/proc` cannot be read. Read now and then,
// apart from the process table, and joined to the process tree of each session: what a session
// started (a dev server) shows with it.
import fs from 'node:fs';
import path from 'node:path';
import { runTool } from '../tools/ToolRunner';

export type PortTable = Map<number, number[]>;

const add = (table: PortTable, pid: number, port: number) => {
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(port) || port <= 0) return;
  const list = table.get(pid) ?? [];
  if (!list.includes(port)) list.push(port);
  table.set(pid, list);
};

/** `  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    1234` (any language: the state is not read). */
export function parseNetstat(text: string): PortTable {
  const table: PortTable = new Map();
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    // TCP, local, remote, state, pid: a listening socket has the remote side at port 0.
    if (parts.length !== 5 || parts[0] !== 'TCP') continue;
    const local = /:(\d+)$/.exec(parts[1]!);
    const remotePort = /:(\d+)$/.exec(parts[2]!)?.[1];
    if (!local || remotePort !== '0') continue;
    add(table, Number(parts[4]), Number(local[1]));
  }
  return table;
}

/** `LISTEN 0 511 *:5173 *:* users:(("node",pid=4321,fd=24))`. */
export function parseSs(text: string): PortTable {
  const table: PortTable = new Map();
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const local = /:(\d+)$/.exec(parts[3]!);
    if (!local) continue;
    for (const match of line.matchAll(/pid=(\d+)/g)) add(table, Number(match[1]), Number(local[1]));
  }
  return table;
}

/**
 * The listening sockets of `/proc/net/tcp` and `tcp6`, by inode: `sl local rem st ... inode`, with
 * the port in hex after the colon and `0A` as the state LISTEN.
 */
export function parseProcNetTcp(text: string): Map<string, number> {
  const ports = new Map<string, number>();
  for (const line of text.split('\n').slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 10 || parts[3] !== '0A') continue;
    const port = parseInt(parts[1]!.split(':')[1] ?? '', 16);
    if (port > 0 && parts[9] !== '0') ports.set(parts[9]!, port);
  }
  return ports;
}

/** Linux: the listening sockets, joined to the processes whose descriptors hold them. */
async function procPorts(root = '/proc'): Promise<PortTable | null> {
  const sockets = new Map<string, number>();
  let read = false;
  for (const name of ['tcp', 'tcp6']) {
    const text = await fs.promises.readFile(path.join(root, 'net', name), 'utf8').catch(() => null);
    if (text === null) continue;
    read = true;
    for (const [inode, port] of parseProcNetTcp(text)) sockets.set(inode, port);
  }
  if (!read) return null;
  const table: PortTable = new Map();
  if (sockets.size === 0) return table;
  const pids = (await fs.promises.readdir(root).catch(() => [] as string[])).filter((n) =>
    /^\d+$/.test(n),
  );
  for (const pid of pids) {
    const fdDir = path.join(root, pid, 'fd');
    // Processes of other users cannot be read, and are none of the sessions' anyway.
    const fds = await fs.promises.readdir(fdDir).catch(() => [] as string[]);
    for (const fd of fds) {
      const target = await fs.promises.readlink(path.join(fdDir, fd)).catch(() => '');
      const inode = /^socket:\[(\d+)\]$/.exec(target)?.[1];
      const port = inode ? sockets.get(inode) : undefined;
      if (port) add(table, Number(pid), port);
    }
  }
  return table;
}

/** The listening ports of every process the user can see; empty when nothing can be read. */
export async function listeningPorts(platform = process.platform): Promise<PortTable> {
  if (platform === 'linux') {
    const fromProc = await procPorts();
    if (fromProc) return fromProc;
  }
  const windows = platform === 'win32';
  const result = await runTool({
    file: windows ? 'netstat' : 'ss',
    args: windows ? ['-ano', '-p', 'TCP'] : ['-ltnpH'],
    cwd: process.cwd(),
    timeoutMs: 5000,
    maxOutputChars: 512 * 1024,
  });
  if (result.exitCode !== 0) return new Map();
  return windows ? parseNetstat(result.stdout) : parseSs(result.stdout);
}

/** The ports of a process tree, in order, without repeats. */
export function portsOf(table: PortTable, pids: Iterable<number>): number[] {
  const ports = new Set<number>();
  for (const pid of pids) for (const port of table.get(pid) ?? []) ports.add(port);
  return [...ports].sort((a, b) => a - b);
}
