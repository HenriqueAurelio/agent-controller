// The TCP ports each process listens on, from the system's own tool: `netstat -ano` on Windows,
// `ss -ltnpH` on Linux. Read now and then, apart from the process table, and joined to the process
// tree of each session: what a session started (a dev server) shows with it.
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

/** The listening ports of every process the user can see; empty when the tool is missing. */
export async function listeningPorts(platform = process.platform): Promise<PortTable> {
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
