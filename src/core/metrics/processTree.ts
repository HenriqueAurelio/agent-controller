import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline';

export interface ProcessInfo {
  pid: number;
  ppid: number;
  /** Resident memory in bytes. */
  memory: number;
  /** CPU time consumed so far, in milliseconds. */
  cpuTimeMs: number;
}

export type ProcessTable = Map<number, ProcessInfo>;

/** Every pid in the tree rooted at `root`, root first. */
export function descendantsOf(table: ProcessTable, root: number): number[] {
  const children = new Map<number, number[]>();
  for (const p of table.values()) {
    const list = children.get(p.ppid);
    if (list) list.push(p.pid);
    else children.set(p.ppid, [p.pid]);
  }
  const out: number[] = [];
  const seen = new Set<number>();
  const stack = [root];
  while (stack.length) {
    const pid = stack.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    if (pid === root || table.has(pid)) out.push(pid);
    for (const child of children.get(pid) ?? []) stack.push(child);
  }
  return out;
}

const CLOCK_TICK_MS = 10; // USER_HZ is 100 on every Linux the app supports.
const PAGE_SIZE = 4096;

function readLinuxProcess(pid: number): ProcessInfo | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // The command name is in parentheses and may itself contain spaces or parentheses.
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ppid = Number(rest[1]);
    const utime = Number(rest[11]);
    const stime = Number(rest[12]);
    const rssPages = Number(rest[21]);
    return {
      pid,
      ppid,
      memory: rssPages * PAGE_SIZE,
      cpuTimeMs: (utime + stime) * CLOCK_TICK_MS,
    };
  } catch {
    return null; // The process ended between readdir and read.
  }
}

function snapshotLinux(): ProcessTable {
  const table: ProcessTable = new Map();
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const info = readLinuxProcess(Number(name));
    if (info) table.set(info.pid, info);
  }
  return table;
}

// One long-lived PowerShell answers every sample: starting a process per sample (or per session)
// would cost more CPU than what is being measured.
const WINDOWS_LOOP = [
  '$ErrorActionPreference = "SilentlyContinue"',
  'while ($true) {',
  '  $line = [Console]::In.ReadLine()',
  '  if ($null -eq $line) { break }',
  '  Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize,KernelModeTime,UserModeTime | ForEach-Object {',
  '    [Console]::Out.WriteLine("$($_.ProcessId),$($_.ParentProcessId),$($_.WorkingSetSize),$($_.KernelModeTime),$($_.UserModeTime)")',
  '  }',
  '  [Console]::Out.WriteLine("END")',
  '}',
].join('\n');

export function parseWindowsRows(lines: string[]): ProcessTable {
  const table: ProcessTable = new Map();
  for (const line of lines) {
    const [pid, ppid, memory, kernel, user] = line.split(',').map(Number);
    if (!pid || Number.isNaN(pid)) continue;
    table.set(pid, {
      pid,
      ppid: ppid || 0,
      memory: memory || 0,
      // Kernel and user times come in 100 ns units.
      cpuTimeMs: ((kernel || 0) + (user || 0)) / 10000,
    });
  }
  return table;
}

class WindowsProcessReader {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending: { resolve: (t: ProcessTable) => void; lines: string[] }[] = [];

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const child = spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        WINDOWS_LOOP,
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    child.stderr.resume();
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      const current = this.pending[0];
      if (!current) return;
      if (line.trim() === 'END') {
        this.pending.shift();
        current.resolve(parseWindowsRows(current.lines));
      } else {
        current.lines.push(line);
      }
    });
    const fail = () => {
      if (this.child === child) this.child = null;
      for (const p of this.pending.splice(0)) p.resolve(new Map());
    };
    child.on('error', fail);
    child.on('exit', fail);
    this.child = child;
    return child;
  }

  snapshot(): Promise<ProcessTable> {
    return new Promise((resolve) => {
      try {
        const child = this.ensure();
        this.pending.push({ resolve, lines: [] });
        child.stdin.write('\n');
      } catch {
        resolve(new Map());
      }
    });
  }

  dispose(): void {
    const child = this.child;
    this.child = null;
    if (!child) return;
    try {
      child.stdin.end();
      child.kill();
    } catch {
      // Already gone.
    }
  }
}

export interface ProcessReader {
  snapshot(): Promise<ProcessTable>;
  dispose(): void;
}

export function createProcessReader(): ProcessReader {
  if (process.platform === 'win32') return new WindowsProcessReader();
  return {
    snapshot: async () => snapshotLinux(),
    dispose: () => {},
  };
}

/** One-off snapshot, for callers that do not sample repeatedly. */
export async function snapshotProcesses(): Promise<ProcessTable> {
  const reader = createProcessReader();
  try {
    return await reader.snapshot();
  } finally {
    reader.dispose();
  }
}
